import re
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from routers.agents import router as agents_router
from routers.audit import router as audit_router
from routers.auth import router as auth_router
from routers.commands import router as commands_router
from routers.files import router as files_router
from routers.kimi import router as kimi_router
from routers.native import router as native_router
from routers.notes import router as notes_router
from routers.push import router as push_router
from routers.services import router as services_router
from routers.sudo import router as sudo_router
from routers.themes import router as themes_router
from routers.tickets import router as tickets_router
from routers.vault import init_vault_db
from routers.vault import router as vault_router
from utils.auth_jwt import get_auth_from_request, verify_token
from utils.cache import CachedStaticFiles
from worker import start_background_tasks, stop_background_tasks

from config import (
    AGENTD_URL,
    CHANGELOG_PATH,
    DB_PATH,
    HOST_BRIDGE_URL,
    JERICHO_BUILD,
    JERICHO_VERSION,
    MONITOR_URL,
    SHELL_URL,
    TERMINAL_BRIDGE_URL,
)


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
    init_vault_db()


init_db()


# ─── Sub-versioning & Auto-log ────────────────────────────────────────────────
def log_version_change():
    last_version = None
    try:
        if CHANGELOG_PATH.exists():
            with open(CHANGELOG_PATH) as f:
                lines = f.read().strip().split("\n")
                for line in reversed(lines):
                    if line.strip():
                        parts = line.split(" ", 2)
                        if len(parts) >= 2:
                            last_version = parts[1]
                            break
    except Exception as e:
        print(f"[version-log] failed to read changelog: {e}")

    if last_version != JERICHO_VERSION:
        ts = datetime.now(UTC).isoformat()
        entry = f"{ts} {JERICHO_VERSION} build={JERICHO_BUILD}\n"
        try:
            with open(CHANGELOG_PATH, "a") as f:
                f.write(entry)
        except Exception as e:
            print(f"[version-log] failed to write changelog: {e}")


log_version_change()


# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    observer, task = await start_background_tasks()
    yield
    stop_background_tasks(observer, task)


# ─── FastAPI ──────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Jericho Command Center API",
    description="Mobile-first PWA API for Linux server management and AI agent orchestration",
    version=f"{JERICHO_VERSION}-b{JERICHO_BUILD}",
    lifespan=lifespan,
)

app.mount("/static", CachedStaticFiles(directory="/app/static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Client-Type Middleware ───────────────────────────────────────────────────
@app.middleware("http")
async def client_type_middleware(request: Request, call_next):
    from utils.capabilities import detect_client_type

    request.state.client_type = detect_client_type(request)
    request.state.tier = "free"
    request.state.attested = False
    request.state.user_id = None

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
    with open("/app/templates/index.html", encoding="utf-8") as f:
        html = f.read()
    bust = str(int(time.time()))
    html = re.sub(r"\?v=\d+", "?b=" + bust, html)
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Clear-Site-Data": '"cookies", "storage"',
    }
    return HTMLResponse(content=html, headers=headers)


# ─── Health Check ─────────────────────────────────────────────────────────────
async def _check_subsystem_health(url: str) -> dict:
    """Quick health probe against a subsystem."""
    import aiohttp

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3)) as session:
            async with session.get(f"{url}/health") as resp:
                if resp.status == 200:
                    content_type = resp.headers.get("content-type", "")
                    if "application/json" in content_type:
                        data = await resp.json()
                    else:
                        data = {"text": await resp.text()}
                    return {"status": "up", "detail": data}
                return {"status": "down", "detail": f"HTTP {resp.status}"}
    except Exception as exc:
        return {"status": "unreachable", "detail": str(exc)}


def _get_worker_health() -> dict:
    """Read latest health records from worker's SQLite table."""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute(
            "SELECT service, status, checked_at FROM service_health ORDER BY checked_at DESC"
        )
        rows = c.fetchall()
        conn.close()
        result = {}
        seen = set()
        for service, status, checked_at in rows:
            if service not in seen:
                result[service] = {"status": status, "checked_at": checked_at}
                seen.add(service)
        return result
    except Exception:
        return {}


@app.get("/health")
async def health():
    """Granular health check exposing all subsystem statuses."""
    subsystems = {
        "agentd": await _check_subsystem_health(AGENTD_URL),
        "shell": await _check_subsystem_health(SHELL_URL),
        "monitor": await _check_subsystem_health(MONITOR_URL),
        "terminal_bridge": await _check_subsystem_health(TERMINAL_BRIDGE_URL),
        "host_bridge": await _check_subsystem_health(HOST_BRIDGE_URL),
    }
    # Merge worker health pulse data
    worker_health = _get_worker_health()
    for svc, record in worker_health.items():
        if svc not in subsystems:
            subsystems[svc] = record
        else:
            # Worker data may be more recent
            subsystems[svc]["worker_status"] = record.get("status")
            subsystems[svc]["worker_checked_at"] = record.get("checked_at")

    all_up = all(
        s.get("status") in ("up", "healthy")
        for s in subsystems.values()
    )

    return {
        "ok": all_up,
        "service": "jericho-api",
        "build": JERICHO_BUILD,
        "version": JERICHO_VERSION,
        "timestamp": datetime.now(UTC).isoformat(),
        "subsystems": subsystems,
    }


# ─── Capabilities ─────────────────────────────────────────────────────────────
@app.get("/api/web/capabilities")
async def get_capabilities(request: Request):
    """Return the authenticated user's capability matrix."""
    from utils.capabilities import detect_client_type, get_capabilities

    token_data = get_auth_from_request(request)
    client_type = detect_client_type(request)
    tier = token_data.get("tier", "free")
    caps = get_capabilities(client_type, tier)
    return {
        "client_type": client_type,
        "tier": tier,
        "capabilities": caps,
    }


# ─── Routers ──────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(tickets_router)
app.include_router(files_router)
app.include_router(services_router)
app.include_router(notes_router)
app.include_router(themes_router)
app.include_router(commands_router)
app.include_router(kimi_router)
app.include_router(sudo_router)
app.include_router(native_router)
app.include_router(audit_router)
app.include_router(agents_router)
app.include_router(push_router)
app.include_router(vault_router)
