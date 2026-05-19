import json
import os
import re
import socket
import subprocess
import sqlite3
import shutil
import urllib.request
import yaml
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Request, Form, HTTPException, status, UploadFile, File, Depends
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.staticfiles import StaticFiles as BaseStaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from auth import (
    hash_passphrase,
    verify_passphrase,
    verify_totp,
    create_session,
    verify_session,
)
from auth_jwt import (
    mint_access_token,
    mint_refresh_token,
    verify_token,
    verify_refresh_token,
    rotate_refresh_token,
    revoke_all_user_tokens,
    mint_terminal_ticket,
    get_auth_from_request,
    init_jwt_db,
)
from capabilities import detect_client_type, get_capabilities
from worker import start_background_tasks, stop_background_tasks, get_cached_dir, cache_dir

# ─── Command Registry ─────────────────────────────────────────────────────────
COMMAND_REGISTRY = {
    "system": [
        {"id": "df_h", "command": "df -h", "description": "Disk usage", "icon": "💾", "dangerous": False},
        {"id": "free_m", "command": "free -m", "description": "Memory usage", "icon": "🧠", "dangerous": False},
        {"id": "uptime", "command": "uptime", "description": "System uptime", "icon": "⏱️", "dangerous": False},
        {"id": "ps_aux", "command": "ps aux --sort=-%cpu | head -20", "description": "Top processes", "icon": "📈", "dangerous": False},
        {"id": "whoami", "command": "whoami", "description": "Current user", "icon": "👤", "dangerous": False},
        {"id": "uname_a", "command": "uname -a", "description": "Kernel info", "icon": "🐧", "dangerous": False},
    ],
    "network": [
        {"id": "ip_addr", "command": "ip addr", "description": "IP addresses", "icon": "🌐", "dangerous": False},
        {"id": "ss_tlnp", "command": "ss -tlnp", "description": "Listening ports", "icon": "🔌", "dangerous": False},
        {"id": "ping_gw", "command": "ping -c 3 8.8.8.8", "description": "Ping Google DNS", "icon": "📡", "dangerous": False},
    ],
    "docker": [
        {"id": "docker_ps", "command": "docker ps", "description": "Running containers", "icon": "🐳", "dangerous": False},
        {"id": "docker_images", "command": "docker images", "description": "Docker images", "icon": "📦", "dangerous": False},
        {"id": "docker_stats", "command": "docker stats --no-stream", "description": "Container stats", "icon": "📊", "dangerous": False},
        {"id": "docker_compose_ps", "command": "docker compose ps", "description": "Compose services", "icon": "🎼", "dangerous": False},
        {"id": "docker_logs", "command": "docker logs --tail 50 $(docker ps -q | head -1)", "description": "Latest container logs", "icon": "📜", "dangerous": False},
        {"id": "docker_prune", "command": "docker system prune -f", "description": "Prune Docker (DANGER)", "icon": "⚠️", "dangerous": True},
    ],
    "git": [
        {"id": "git_status", "command": "git status", "description": "Git status", "icon": "🌿", "dangerous": False},
        {"id": "git_log", "command": "git log --oneline -10", "description": "Recent commits", "icon": "📜", "dangerous": False},
        {"id": "git_branch", "command": "git branch -a", "description": "All branches", "icon": "🌲", "dangerous": False},
    ],
    "dangerous": [
        {"id": "reboot", "command": "sudo reboot", "description": "Reboot server", "icon": "🔴", "dangerous": True},
        {"id": "shutdown", "command": "sudo shutdown now", "description": "Shutdown server", "icon": "⛔", "dangerous": True},
    ],
}

DANGEROUS_PATTERNS = [
    re.compile(r'(?i)^\s*rm\s+'),
    re.compile(r'(?i)^\s*dd\s+'),
    re.compile(r'(?i)^\s*mkfs\.?'),
    re.compile(r'(?i)^\s*fdisk\s+'),
    re.compile(r'(?i)^\s*shutdown\s+'),
    re.compile(r'(?i)^\s*reboot\s+'),
    re.compile(r'(?i)^\s*docker\s+system\s+prune'),
    re.compile(r'(?i)^\s*docker\s+volume\s+prune'),
    re.compile(r'(?i)^\s*kill\s+-9'),
    re.compile(r'(?i)^\s*pkill\s+-9'),
]

# ─── Rate Limiter ─────────────────────────────────────────────────────────────
class TokenBucket:
    def __init__(self, rate: float, burst: int):
        self.rate = rate
        self.burst = burst
        self.tokens = float(burst)
        self.last = time.time()

    def allow(self) -> bool:
        now = time.time()
        elapsed = now - self.last
        self.tokens = min(self.burst, self.tokens + elapsed * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

    def retry_after(self) -> int:
        return int((1 - self.tokens) / self.rate) + 1

_rate_limiters = {}

def get_rate_limiter(key: str, rate: float, burst: int) -> TokenBucket:
    if key not in _rate_limiters:
        _rate_limiters[key] = TokenBucket(rate, burst)
    return _rate_limiters[key]

def is_dangerous_command(cmd: str) -> bool:
    return any(p.search(cmd) for p in DANGEROUS_PATTERNS)

def check_rate_limit(client_key: str, cmd: str):
    if is_dangerous_command(cmd):
        bucket = get_rate_limiter(f"{client_key}:dangerous", rate=1/60, burst=1)
    else:
        bucket = get_rate_limiter(f"{client_key}:safe", rate=10.0, burst=20)
    if not bucket.allow():
        raise HTTPException(
            status_code=429,
            detail={"ok": False, "error_code": 429, "description": "Too Many Requests", "parameters": {"retry_after": bucket.retry_after()}}
        )

import time

# ─── Auth helper (prototype bypass) ───────────────────────────────────────────
def require_auth(request: Request):
    """Verify Bearer token or session; prototype bypass if neither present."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return verify_token(auth_header[7:], "access")
    try:
        return verify_session(request)
    except HTTPException:
        # Prototype bypass: no auth required
        return {"sub": "prototype", "client_type": "web", "tier": "free"}

# ─── Config ───────────────────────────────────────────────────────────────────
DATA_DIR = Path("/data")
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "jericho.db"
PASSPHRASE_HASH = os.environ.get("JERICHO_PASSPHRASE_HASH", "").strip("'\"")
TOTP_SECRET = os.environ.get("JERICHO_TOTP_SECRET", "")
SECRET_KEY = os.environ.get("JERICHO_SECRET_KEY", "")
TICKET_SECRET = os.environ.get("JERICHO_TICKET_SECRET", SECRET_KEY)

# ─── DB init ──────────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT,
            event TEXT,
            ip TEXT,
            detail TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            content TEXT,
            updated TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS themes (
            id TEXT PRIMARY KEY,
            name TEXT,
            description TEXT,
            category TEXT,
            tokens TEXT,
            fontFamily TEXT,
            effects TEXT,
            created TEXT,
            updated TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()
init_jwt_db()

# ─── Helpers ──────────────────────────────────────────────────────────────────
def audit(event: str, ip: str, detail: str = ""):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO audit (ts, event, ip, detail) VALUES (?, ?, ?, ?)",
              (datetime.now(timezone.utc).isoformat(), event, ip, detail))
    conn.commit()
    conn.close()

# ─── Sub-versioning & Auto-log ────────────────────────────────────────────────
JERICHO_VERSION = "0.10.0"
JERICHO_BUILD = "21"
CHANGELOG_PATH = DATA_DIR / "changelog.log"

def log_version_change():
    """Write a version-change entry to changelog.log on startup if version changed."""
    last_version = None
    try:
        if CHANGELOG_PATH.exists():
            with open(CHANGELOG_PATH, "r") as f:
                lines = f.read().strip().split("\n")
                for line in reversed(lines):
                    if line.strip():
                        parts = line.split(" ", 2)
                        if len(parts) >= 2:
                            last_version = parts[1]
                            break
    except Exception:
        pass

    if last_version != JERICHO_VERSION:
        ts = datetime.now(timezone.utc).isoformat()
        entry = f"{ts} {JERICHO_VERSION} build={JERICHO_BUILD}\n"
        try:
            with open(CHANGELOG_PATH, "a") as f:
                f.write(entry)
        except Exception as e:
            print(f"[version-log] failed to write changelog: {e}")

log_version_change()

class LoginRequest(BaseModel):
    passphrase: str
    totp: str


class NoteSave(BaseModel):
    name: str
    content: str


class ThemeSave(BaseModel):
    id: str
    name: str
    description: str
    category: str
    tokens: str
    fontFamily: str
    effects: str


# ─── Caching ──────────────────────────────────────────────────────────────────
class CachedStaticFiles(BaseStaticFiles):
    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

_api_cache = {}

def cached(cache_key, ttl=30, fn=None):
    import time as _time
    now = _time.time()
    if cache_key in _api_cache:
        result, expiry = _api_cache[cache_key]
        if now < expiry:
            return result
    result = fn()
    _api_cache[cache_key] = (result, now + ttl)
    return result

# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    observer, task = await start_background_tasks()
    yield
    stop_background_tasks(observer, task)

# ─── FastAPI ──────────────────────────────────────────────────────────────────
app = FastAPI(title="Jericho Command Center", lifespan=lifespan)

# Static files served at /static/ (FastAPI internal path) — cache forever for versioned assets
app.mount("/static", CachedStaticFiles(directory="/app/static"), name="static")

# CORS: only allow web origins for /api/web/*; native endpoints handled separately
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://YOUR_DOMAIN"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Client-Type Middleware ───────────────────────────────────────────────────
@app.middleware("http")
async def client_type_middleware(request: Request, call_next):
    request.state.client_type = detect_client_type(request)
    request.state.tier = "free"  # default; override from JWT when available
    request.state.attested = False
    request.state.user_id = None

    # If Authorization header present, parse JWT and enrich state
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            token_data = verify_token(auth_header[7:], "access")
            request.state.user_id = token_data.get("sub")
            request.state.client_type = token_data.get("client_type", "web")
            request.state.tier = token_data.get("tier", "free")
            request.state.attested = token_data.get("attested", False)
        except HTTPException:
            pass

    response = await call_next(request)
    return response


# ─── Pages ────────────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    with open("/app/templates/index.html", "r", encoding="utf-8") as f:
        html = f.read()
    # Aggressive cache bust: unique query string on every page load
    bust = str(int(__import__('time').time()))
    import re
    html = re.sub(r'\?v=\d+', '?b=' + bust, html)
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Clear-Site-Data": '"cookies", "storage", "executionContexts"',
    }
    return HTMLResponse(content=html, headers=headers)

@app.get("/health")
async def health():
    return {"ok": True, "service": "jericho-api"}


# ─── Auth (Dual: Passphrase+TOTP → JWT) ───────────────────────────────────────
@app.post("/api/auth/login")
async def login(request: Request, data: LoginRequest):
    ip = request.client.host if request.client else "unknown"
    if not PASSPHRASE_HASH or not verify_passphrase(data.passphrase, PASSPHRASE_HASH):
        audit("login_fail_passphrase", ip)
        raise HTTPException(status_code=401, detail="Invalid passphrase")
    if not TOTP_SECRET or not verify_totp(data.totp, TOTP_SECRET):
        audit("login_fail_totp", ip)
        raise HTTPException(status_code=401, detail="Invalid TOTP")

    user_id = "user_001"  # single-user prototype
    client_type = detect_client_type(request)

    access_token = mint_access_token(user_id, client_type=client_type, tier="free", attested=False)
    refresh_token = mint_refresh_token(user_id)

    audit("login_success", ip, f"client_type={client_type}")

    resp = JSONResponse({
        "ok": True,
        "access_token": access_token,
        "client_type": client_type,
        "tier": "free",
        "capabilities": get_capabilities(client_type, "free"),
    })
    # secure=False for HTTP prototype; set True when HTTPS is enabled
    secure_cookie = request.url.scheme == "https"
    resp.set_cookie(
        key="jericho_refresh",
        value=refresh_token,
        httponly=True,
        secure=secure_cookie,
        samesite="strict",
        max_age=60 * 60 * 24 * 7,
    )
    # Legacy cookie for backward compat during transition
    session = create_session(request)
    resp.set_cookie(
        key="jericho_session",
        value=session,
        httponly=True,
        secure=secure_cookie,
        samesite="strict",
        max_age=900,
    )
    return resp


@app.post("/api/auth/logout")
async def logout(request: Request):
    ip = request.client.host if request.client else "unknown"
    audit("logout", ip)
    # Revoke refresh tokens if we can identify the user
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            token_data = verify_token(auth_header[7:], "access")
            revoke_all_user_tokens(token_data["sub"])
        except HTTPException:
            pass
    resp = JSONResponse({"ok": True})
    secure_cookie = request.url.scheme == "https"
    resp.delete_cookie("jericho_refresh", secure=secure_cookie, httponly=True, samesite="strict")
    resp.delete_cookie("jericho_session", secure=secure_cookie, httponly=True, samesite="strict")
    return resp


@app.post("/api/auth/refresh")
async def refresh(request: Request):
    refresh_token = request.cookies.get("jericho_refresh")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = verify_refresh_token(refresh_token)
        user_id = payload["sub"]
        old_jti = payload["jti"]
        new_refresh = rotate_refresh_token(old_jti, user_id)
        new_access = mint_access_token(user_id)
        resp = JSONResponse({
            "ok": True,
            "access_token": new_access,
        })
        secure_cookie = request.url.scheme == "https"
        resp.set_cookie(
            key="jericho_refresh",
            value=new_refresh,
            httponly=True,
            secure=secure_cookie,
            samesite="strict",
            max_age=60 * 60 * 24 * 7,
        )
        return resp
    except HTTPException:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


async def _me_handler(request: Request):
    """Shared /me handler for all client types."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            token_data = verify_token(auth_header[7:], "access")
            return {
                "ok": True,
                "user_id": token_data.get("sub"),
                "client_type": token_data.get("client_type", "web"),
                "tier": token_data.get("tier", "free"),
                "attested": token_data.get("attested", False),
                "capabilities": get_capabilities(token_data.get("client_type", "web"), token_data.get("tier", "free")),
            }
        except HTTPException:
            pass

    # Legacy fallback
    try:
        require_auth(request)
        return {"ok": True, "client_type": "web", "tier": "free"}
    except HTTPException:
        pass

    # Prototype bypass: no auth required
    return {
        "ok": True,
        "user_id": "prototype",
        "client_type": "web",
        "tier": "free",
        "attested": False,
        "capabilities": get_capabilities("web", "free"),
    }


@app.get("/api/me")
async def me(request: Request):
    return await _me_handler(request)


@app.get("/api/web/me")
async def me_web(request: Request):
    return await _me_handler(request)


@app.get("/api/native/me")
async def me_native(request: Request):
    return await _me_handler(request)


# ─── Terminal Ticket ──────────────────────────────────────────────────────────
@app.post("/api/web/tickets/terminal")
async def ticket_terminal(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    user_id = token_data["sub"]
    client_type = token_data.get("client_type", "web")
    tier = token_data.get("tier", "free")
    attested = token_data.get("attested", False)

    ticket = mint_terminal_ticket(user_id, client_type, tier, attested)
    return {"ticket": ticket, "expires_in": 300}


@app.post("/api/native/tickets/terminal")
async def ticket_terminal_native(request: Request):
    # Native apps must provide attestation token header
    attestation = request.headers.get("X-Attestation-Token", "")
    attested = bool(attestation)  # mock: presence is enough for prototype

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    user_id = token_data["sub"]
    client_type = token_data.get("client_type", "native")
    tier = token_data.get("tier", "free")

    ticket = mint_terminal_ticket(user_id, client_type, tier, attested)
    return {"ticket": ticket, "expires_in": 300, "attested": attested}


# ─── Projects / File Browser ──────────────────────────────────────────────────
@app.get("/api/web/projects")
async def list_projects(request: Request, path: str = "/srv"):
    require_auth(request)
    # Sanitize path — prevent directory traversal
    base = Path("/").resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not target.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")

    # Try cache first
    cached = get_cached_dir(str(target))
    if cached:
        entries, updated_at = cached
        return {
            "path": str(target),
            "parent": str(target.parent) if target != base else None,
            "entries": entries,
            "cached": True,
            "cached_at": updated_at,
        }

    entries = []
    try:
        for entry in target.iterdir():
            name = entry.name
            if name.startswith("."):
                continue
            stat = entry.stat()
            entries.append({
                "name": name,
                "path": str(entry),
                "type": "directory" if entry.is_dir() else "file",
                "size": stat.st_size if entry.is_file() else None,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    except PermissionError:
        pass

    # Sort: directories first, then alphabetically
    entries.sort(key=lambda e: (0 if e["type"] == "directory" else 1, e["name"].lower()))

    # Write to cache
    cache_dir(str(target), entries)

    return {
        "path": str(target),
        "parent": str(target.parent) if target != base else None,
        "entries": entries,
    }


@app.get("/api/web/download")
async def download_file(request: Request, path: str):
    require_auth(request)
    base = Path("/").resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(target, filename=target.name)


@app.get("/api/web/preview")
async def preview_file(request: Request, path: str):
    require_auth(request)
    base = Path("/").resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    MAX_PREVIEW = 1024 * 1024  # 1MB
    size = target.stat().st_size
    name = target.name.lower()

    # Image types
    if name.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp")):
        import base64
        with open(target, "rb") as f:
            data = f.read()
        mime = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
            ".bmp": "image/bmp",
        }.get(Path(name).suffix, "application/octet-stream")
        b64 = base64.b64encode(data).decode("utf-8")
        return {
            "name": target.name,
            "type": "image",
            "size": size,
            "content": f"data:{mime};base64,{b64}",
        }

    # Text types
    text_exts = (
        ".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".toml",
        ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss",
        ".sh", ".bash", ".zsh", ".fish", ".ps1",
        ".go", ".rs", ".java", ".kt", ".scala", ".clj",
        ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
        ".rb", ".php", ".pl", ".pm", ".lua", ".r",
        ".sql", ".graphql", ".prisma",
        ".dockerfile", ".nginx", ".conf", ".cfg", ".ini",
        ".log", ".csv", ".tsv",
        ".xml", ".svg",
    )
    if name.endswith(text_exts) or size < 4096:
        try:
            with open(target, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(MAX_PREVIEW)
            ftype = "markdown" if name.endswith((".md", ".markdown")) else (
                "json" if name.endswith(".json") else (
                    "code" if name.endswith(text_exts) else "text"
                )
            )
            return {
                "name": target.name,
                "type": ftype,
                "size": size,
                "content": content,
                "truncated": size > MAX_PREVIEW,
            }
        except Exception:
            pass

    return {
        "name": target.name,
        "type": "binary",
        "size": size,
        "content": "Binary file — preview not available",
    }


# ─── Service Directory ────────────────────────────────────────────────────────
def _fetch_local_services():
    services = []
    try:
        result = subprocess.run(
            ["ss", "-tlnp"],
            capture_output=True, text=True, timeout=5,
        )
        lines = result.stdout.splitlines()
        for line in lines[1:]:
            parts = line.split()
            if len(parts) < 5:
                continue
            local = parts[3]
            if ":" not in local:
                continue
            ip, port = local.rsplit(":", 1)
            if not port.isdigit():
                continue
            port = int(port)
            if ip in ("127.0.0.1", "127.0.0.54", "::1"):
                url = f"http://127.0.0.1:{port}"
            else:
                url = f"http://YOUR_TAILSCALE_IP:{port}"
            services.append({"port": port, "ip": ip, "url": url, "process": ""})
    except Exception:
        pass
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}\t{{.Ports}}"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.splitlines():
            if "\t" in line:
                name, ports = line.split("\t", 1)
                services.append({"port": 0, "ip": "docker", "url": "", "process": name, "ports": ports})
    except Exception:
        pass
    return services

@app.get("/api/web/services/local")
async def local_services(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    return cached("local_services", ttl=15, fn=_fetch_local_services)


def _discover_cloudflared_hosts():
    """Parse ALL cloudflared config files for public hostnames."""
    hosts = []
    try:
        config_dir = Path("/etc/cloudflared")
        if not config_dir.exists():
            return hosts
        for config_path in config_dir.glob("*.yml"):
            with open(config_path) as f:
                config = yaml.safe_load(f)
            if not config or not isinstance(config, dict):
                continue
            tunnel_name = config.get("tunnel", config_path.stem)
            for rule in config.get("ingress", []):
                if not isinstance(rule, dict):
                    continue
                hostname = rule.get("hostname", "")
                service = rule.get("service", "")
                path = rule.get("path", "")
                if hostname and service and not service.startswith("http_status"):
                    port = None
                    if "localhost:" in service:
                        try:
                            port = int(service.split("localhost:")[1].split("/")[0])
                        except (ValueError, IndexError):
                            pass
                    desc = f"Tunnel [{tunnel_name}]"
                    if path:
                        desc += f" → {service}{path}"
                    else:
                        desc += f" → {service}"
                    hosts.append({
                        "domain": hostname,
                        "url": f"https://{hostname}{path}" if path else f"https://{hostname}",
                        "port": port,
                        "source": "cloudflared",
                        "description": desc,
                    })
    except Exception as e:
        print(f"[discover] cloudflared error: {e}")
    return hosts


def _discover_nginx_hosts():
    """Parse nginx configs for server_name + listen pairs."""
    hosts = []
    try:
        for conf_file in Path("/etc/nginx").rglob("*.conf"):
            text = conf_file.read_text()
            servers = re.findall(
                r"server\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}", text, re.DOTALL
            )
            for block in servers:
                listen_match = re.search(r"listen\s+(\d+)", block)
                server_name_match = re.search(r"server_name\s+([^;]+)", block)
                if listen_match and server_name_match:
                    port = int(listen_match.group(1))
                    names = server_name_match.group(1).strip().split()
                    for name in names:
                        if name in ("_", "default"):
                            continue
                        hosts.append({
                            "domain": name,
                            "url": f"https://{name}",
                            "port": port,
                            "source": "nginx",
                            "description": f"Nginx port {port}",
                        })
    except Exception as e:
        print(f"[discover] nginx error: {e}")
    return hosts


def _check_port_health(port, ip="127.0.0.1"):
    """Quick TCP connect check to verify service is reachable."""
    try:
        with socket.create_connection((ip, port), timeout=2):
            return True
    except Exception:
        return False


def _fetch_public_services():
    """Hybrid discovery: merge cloudflared + nginx + manual config."""
    config_path = Path("/srv/jericho/public-routes.json")
    manual = []
    if config_path.exists():
        try:
            manual = json.loads(config_path.read_text())
            for item in manual:
                item["source"] = "manual"
        except Exception:
            pass

    discovered = []
    discovered.extend(_discover_cloudflared_hosts())
    discovered.extend(_discover_nginx_hosts())

    seen = set()
    merged = []
    for item in manual + discovered:
        domain = item.get("domain", "")
        if not domain or domain in seen:
            continue
        seen.add(domain)
        port = item.get("port")
        if port and isinstance(port, int) and port > 0:
            item["healthy"] = _check_port_health(port)
        else:
            item["healthy"] = None
        merged.append(item)

    return merged


@app.get("/api/web/services/public")
async def public_services(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    return cached("public_services", ttl=60, fn=_fetch_public_services)


# ─── Docker Pulse ─────────────────────────────────────────────────────────────
def _fetch_docker_containers():
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}"],
            capture_output=True, text=True, timeout=5,
        )
        containers = []
        for line in result.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) >= 3:
                containers.append({
                    "id": parts[0][:12],
                    "name": parts[1],
                    "status": parts[2],
                    "image": parts[3] if len(parts) > 3 else "",
                })
        return containers
    except Exception:
        return []

@app.get("/api/web/docker/containers")
async def docker_containers(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    return cached("docker_containers", ttl=15, fn=_fetch_docker_containers)


# ─── Tailscale Watch ──────────────────────────────────────────────────────────
def _fetch_tailscale_peers():
    try:
        result = subprocess.run(
            [
                "curl", "-s", "--unix-socket", "/run/tailscale/tailscaled.sock",
                "http://local-tailscaled.sock/localapi/v0/status",
            ],
            capture_output=True, text=True, timeout=5,
        )
        data = json.loads(result.stdout)
        peers = []
        self_peer = data.get("Self", {})
        if self_peer:
            peers.append({
                "name": self_peer.get("HostName", "self"),
                "ip": self_peer.get("TailscaleIPs", [""])[0],
                "os": self_peer.get("OS", "?"),
                "online": self_peer.get("Online", False),
                "last_seen": self_peer.get("LastSeen", ""),
                "is_self": True,
            })
        for key, peer in data.get("Peer", {}).items():
            peers.append({
                "name": peer.get("HostName", key),
                "ip": peer.get("TailscaleIPs", [""])[0],
                "os": peer.get("OS", "?"),
                "online": peer.get("Online", False),
                "last_seen": peer.get("LastSeen", ""),
                "is_self": False,
            })
        return peers
    except Exception:
        return []

@app.get("/api/web/tailscale/peers")
async def tailscale_peers(request: Request):
    require_auth(request)
    return cached("tailscale_peers", ttl=30, fn=_fetch_tailscale_peers)


# ─── Scratchpad / Notes ───────────────────────────────────────────────────────
@app.get("/api/web/notes")
async def list_notes(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT name, updated FROM notes ORDER BY updated DESC")
    rows = c.fetchall()
    conn.close()
    return [{"name": r[0], "updated": r[1]} for r in rows]


@app.get("/api/web/notes/{name}")
async def get_note(request: Request, name: str):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT content FROM notes WHERE name = ?", (name,))
    row = c.fetchone()
    conn.close()
    if not row:
        return {"name": name, "content": "", "updated": ""}
    return {"name": name, "content": row[0], "updated": ""}


@app.post("/api/web/notes/{name}")
async def save_note(request: Request, name: str, body: NoteSave):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now = datetime.now(timezone.utc).isoformat()
    c.execute("""
        INSERT INTO notes (name, content, updated) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET content=excluded.content, updated=excluded.updated
    """, (name, body.content, now))
    conn.commit()
    conn.close()
    return {"ok": True}


# ─── Quick Capture ────────────────────────────────────────────────────────────
@app.post("/api/web/upload")
async def upload(request: Request, file: UploadFile = File(...), folder: str = "inbox"):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    dest_dir = Path(f"/srv/{folder}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / file.filename
    with open(dest, "wb") as f:
        f.write(await file.read())
    return {"ok": True, "path": str(dest)}


# ─── Kimi Sessions ────────────────────────────────────────────────────────────
HOST_BRIDGE = os.environ.get("HOST_BRIDGE_URL", "YOUR_HOST_BRIDGE_URL")

@app.get("/api/web/kimi/sessions")
async def kimi_sessions(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    try:
        result = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", "--connect-timeout", "3", f"{HOST_BRIDGE}/sessions"],
            capture_output=True, text=True, timeout=5,
        )
        lines = result.stdout.strip().split("\n") if result.stdout else []
        if len(lines) >= 2:
            http_code = lines[-1].strip()
            body = "\n".join(lines[:-1])
            if http_code != "200":
                raise HTTPException(status_code=int(http_code), detail=body or "Host bridge error")
            return json.loads(body) if body else []
        return []
    except HTTPException:
        raise
    except Exception:
        return []

@app.post("/api/web/kimi/sessions/{uuid}/launch")
async def kimi_launch(request: Request, uuid: str):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    ip = request.client.host if request.client else "unknown"
    try:
        result = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", "-X", "POST", "--connect-timeout", "3", f"{HOST_BRIDGE}/launch/{uuid}"],
            capture_output=True, text=True, timeout=10,
        )
        lines = result.stdout.strip().split("\n") if result.stdout else []
        if len(lines) >= 2:
            http_code = lines[-1].strip()
            body = "\n".join(lines[:-1])
            if http_code != "200":
                detail = json.loads(body).get("detail", body) if body else "Host bridge error"
                raise HTTPException(status_code=int(http_code), detail=detail)
            data = json.loads(body) if body else {}
            audit("kimi_launch", ip, f"uuid={uuid} port={data.get('port')}")
            return data
        return {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/web/kimi/sessions/{port}/stop")
async def kimi_stop(request: Request, port: int):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    ip = request.client.host if request.client else "unknown"
    try:
        result = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", "-X", "POST", "--connect-timeout", "3", f"{HOST_BRIDGE}/stop/{port}"],
            capture_output=True, text=True, timeout=5,
        )
        lines = result.stdout.strip().split("\n") if result.stdout else []
        if len(lines) >= 2:
            http_code = lines[-1].strip()
            body = "\n".join(lines[:-1])
            if http_code != "200":
                detail = json.loads(body).get("detail", body) if body else "Host bridge error"
                raise HTTPException(status_code=int(http_code), detail=detail)
            audit("kimi_stop", ip, f"port={port}")
            return json.loads(body) if body else {"ok": True}
        audit("kimi_stop", ip, f"port={port}")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Agent Platforms Discovery ────────────────────────────────────────────────
PLATFORMS_YAML = Path("/srv/jericho/agent-platforms.yaml")

def load_platforms():
    try:
        import yaml
        data = yaml.safe_load(open(PLATFORMS_YAML, "r"))
        return data.get("platforms", [])
    except Exception:
        return []

def _fetch_platforms():
    platforms = load_platforms()
    active = []
    for p in platforms:
        try:
            url = f"http://127.0.0.1:{p['port']}{p['health_endpoint']}"
            req = urllib.request.Request(url, method="HEAD")
            req.add_header("User-Agent", "Jericho-Probe/1.0")
            with urllib.request.urlopen(req, timeout=2) as resp:
                status = resp.status
        except Exception:
            status = 0
        active.append({
            "id": p["id"],
            "name": p["name"],
            "icon": p["icon"],
            "description": p["description"],
            "category": p.get("category", "general"),
            "status": "online" if status == 200 else "offline",
            "url": p["proxy_path"],
        })
    return active

@app.get("/api/web/platforms")
async def list_platforms(request: Request):
    require_auth(request)
    return cached("platforms", ttl=60, fn=_fetch_platforms)


# ─── Native Endpoints (Stubbed) ───────────────────────────────────────────────
@app.post("/api/native/push/register")
async def native_push_register(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    if token_data.get("tier") not in ("pro", "team"):
        raise HTTPException(status_code=402, detail="Push notifications require Pro subscription")
    return {"ok": True, "stub": True}


@app.post("/api/native/sync/offline")
async def native_sync_offline(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    if token_data.get("tier") not in ("pro", "team"):
        raise HTTPException(status_code=402, detail="Offline sync requires Pro subscription")
    return {"ok": True, "stub": True}


@app.post("/api/native/biometric")
async def native_biometric(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    if token_data.get("tier") not in ("pro", "team"):
        raise HTTPException(status_code=402, detail="Biometric unlock requires Pro subscription")
    return {"ok": True, "stub": True}


# ─── Debug helpers (prototype only) ───────────────────────────────────────────
@app.get("/api/debug/totp")
async def debug_totp(request: Request):
    """Return current TOTP code for convenience during single-user prototype testing."""
    import pyotp
    if not TOTP_SECRET:
        raise HTTPException(status_code=404, detail="No TOTP configured")
    return {"code": pyotp.TOTP(TOTP_SECRET).now(), "expires_in": 30 - (datetime.now(timezone.utc).second % 30)}


# ─── Themes ───────────────────────────────────────────────────────────────────
@app.get("/api/web/themes")
async def list_themes(request: Request):
    require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id, name, description, category, tokens, fontFamily, effects, created, updated FROM themes ORDER BY updated DESC")
    rows = c.fetchall()
    conn.close()
    return [{
        "id": r[0], "name": r[1], "description": r[2], "category": r[3],
        "tokens": json.loads(r[4]) if r[4] else {},
        "fontFamily": r[5], "effects": json.loads(r[6]) if r[6] else {},
        "created": r[7], "updated": r[8]
    } for r in rows]


@app.post("/api/web/themes")
async def save_theme(request: Request, body: ThemeSave):
    require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now = datetime.now(timezone.utc).isoformat()
    c.execute("""
        INSERT INTO themes (id, name, description, category, tokens, fontFamily, effects, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, description=excluded.description, category=excluded.category,
            tokens=excluded.tokens, fontFamily=excluded.fontFamily, effects=excluded.effects,
            updated=excluded.updated
    """, (body.id, body.name, body.description, body.category, body.tokens, body.fontFamily, body.effects, now, now))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/web/themes/{theme_id}")
async def delete_theme(request: Request, theme_id: str):
    require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM themes WHERE id = ?", (theme_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ─── Command Registry ─────────────────────────────────────────────────────────
@app.get("/api/web/commands")
async def list_commands(request: Request):
    require_auth(request)
    result = {}
    tools_detected = []
    for category, commands in COMMAND_REGISTRY.items():
        visible = []
        for cmd in commands:
            visible.append(cmd)
        if visible:
            result[category] = visible
    # Auto-detect tools
    tool_map = {
        "docker": "docker",
        "git": "git",
        "kubectl": "kubectl",
        "npm": "npm",
        "pip": "pip",
        "pm2": "pm2",
        "nginx": "nginx",
        "terraform": "terraform",
        "ansible": "ansible",
    }
    for tool, binary in tool_map.items():
        if shutil.which(binary):
            tools_detected.append(tool)
    return {"categories": result, "tools_detected": tools_detected}


# ─── Shortcuts ────────────────────────────────────────────────────────────────
SHORTCUTS = {
    "deploy": {
        "name": "Deploy",
        "description": "Pull latest code and redeploy containers",
        "icon": "🚀",
        "dangerous": False,
        "steps": [
            {"cmd": "git pull origin main", "label": "Pull code"},
            {"cmd": "docker build -t app:latest .", "label": "Build image"},
            {"cmd": "docker compose up -d", "label": "Start containers"},
        ]
    },
    "update": {
        "name": "Update System",
        "description": "Update package lists and upgrade packages",
        "icon": "📦",
        "dangerous": False,
        "steps": [
            {"cmd": "sudo apt update", "label": "Update lists"},
            {"cmd": "sudo apt upgrade -y", "label": "Upgrade packages"},
        ]
    },
    "clean": {
        "name": "Clean Docker",
        "description": "Prune unused Docker images and volumes",
        "icon": "🧹",
        "dangerous": True,
        "steps": [
            {"cmd": "docker system prune -f", "label": "Prune images"},
            {"cmd": "docker volume prune -f", "label": "Prune volumes"},
        ]
    },
    "status": {
        "name": "Quick Status",
        "description": "Show system overview",
        "icon": "📊",
        "dangerous": False,
        "steps": [
            {"cmd": "uptime", "label": "Uptime"},
            {"cmd": "df -h", "label": "Disk usage"},
            {"cmd": "free -m", "label": "Memory"},
        ]
    },
}

@app.get("/api/web/shortcuts")
async def list_shortcuts(request: Request):
    require_auth(request)
    return {"shortcuts": SHORTCUTS}


@app.post("/api/web/mkdir")
async def mkdir_endpoint(request: Request):
    require_auth(request)
    body = await request.json()
    path = body.get("path", "")
    if not path:
        raise HTTPException(status_code=400, detail="Missing path")
    # Path traversal protection
    base = Path("/srv").resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=403, detail="Path traversal blocked")
    try:
        os.makedirs(target, exist_ok=True)
        return {"ok": True, "path": str(target)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Audit log ────────────────────────────────────────────────────────────────
@app.get("/api/web/audit")
async def get_audit(request: Request, limit: int = 50):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT ts, event, ip, detail FROM audit ORDER BY id DESC LIMIT ?", (limit,))
    rows = c.fetchall()
    conn.close()
    return [{"ts": r[0], "event": r[1], "ip": r[2], "detail": r[3]} for r in rows]
