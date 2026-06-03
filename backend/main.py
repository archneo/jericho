import re
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from auth_jwt import verify_token
from cache import CachedStaticFiles
from config import DB_PATH, JERICHO_VERSION, JERICHO_BUILD, CHANGELOG_PATH
from worker import start_background_tasks, stop_background_tasks

from routers.auth import router as auth_router
from routers.tickets import router as tickets_router
from routers.files import router as files_router
from routers.services import router as services_router
from routers.notes import router as notes_router
from routers.themes import router as themes_router
from routers.commands import router as commands_router
from routers.kimi import router as kimi_router
from routers.sudo import router as sudo_router
from routers.native import router as native_router
from routers.audit import router as audit_router
from vault.router import router as vault_router, init_vault_db


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


# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    observer, task = await start_background_tasks()
    yield
    stop_background_tasks(observer, task)


# ─── FastAPI ──────────────────────────────────────────────────────────────────
app = FastAPI(title="Jericho Command Center", lifespan=lifespan)

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
    from capabilities import detect_client_type
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
    with open("/app/templates/index.html", "r", encoding="utf-8") as f:
        html = f.read()
    bust = str(int(time.time()))
    html = re.sub(r'\?v=\d+', '?b=' + bust, html)
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Clear-Site-Data": '"cookies", "storage"',
    }
    return HTMLResponse(content=html, headers=headers)


@app.get("/health")
async def health():
    return {"ok": True, "service": "jericho-api"}


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
app.include_router(vault_router)
