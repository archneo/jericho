import os
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────────
DATA_DIR = Path("/data")
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "jericho.db"

# ─── Secrets ──────────────────────────────────────────────────────────────────
PASSPHRASE_HASH = os.environ.get("JERICHO_PASSPHRASE_HASH", "").strip("'\"")
TOTP_SECRET = os.environ.get("JERICHO_TOTP_SECRET", "")
SECRET_KEY = os.environ.get("JERICHO_SECRET_KEY", "")
TICKET_SECRET = os.environ.get("JERICHO_TICKET_SECRET", SECRET_KEY)

# ─── Version ──────────────────────────────────────────────────────────────────
JERICHO_VERSION = "0.10.0"
JERICHO_BUILD = "40"
CHANGELOG_PATH = DATA_DIR / "changelog.log"

# ─── Networking ───────────────────────────────────────────────────────────────
LOCALHOST_IPS = ("127.0.0.1", "127.0.0.54", "::1")

SERVICE_PORTS = {
    "api": 9001,
    "monitor": 9002,
    "agentd": 9003,
    "shell": 9004,
    "host_bridge": 9998,
    "terminal_bridge": 9999,
}


def _service_url(name: str, scheme: str = "http") -> str:
    return f"{scheme}://127.0.0.1:{SERVICE_PORTS[name]}"


AGENTD_URL = _service_url("agentd")
SHELL_URL = _service_url("shell")
HOST_BRIDGE_URL = os.environ.get("HOST_BRIDGE_URL", _service_url("host_bridge"))
TERMINAL_BRIDGE_URL = _service_url("terminal_bridge")

# ─── User / Bridge ────────────────────────────────────────────────────────────
USER_HOME = os.environ.get("JERICHO_USER_HOME", "/home/YOUR_USER")
