# capabilities.py — client-type + tier → capability matrix
from fastapi import HTTPException, Request, status

CAPABILITIES = {
    "web": {
        "terminal": True,
        "agent_control": True,
        "file_browser": True,
        "push_notifications": False,
        "offline_queue": False,
        "biometric_unlock": False,
        "team_sharing": False,
        "audit_logs": False,
    },
    "native_free": {
        "terminal": True,
        "agent_control": True,
        "file_browser": True,
        "push_notifications": False,
        "offline_queue": False,
        "biometric_unlock": False,
        "team_sharing": False,
        "audit_logs": False,
    },
    "native_pro": {
        "terminal": True,
        "agent_control": True,
        "file_browser": True,
        "push_notifications": True,
        "offline_queue": True,
        "biometric_unlock": True,
        "team_sharing": False,
        "audit_logs": False,
    },
    "native_team": {
        "terminal": True,
        "agent_control": True,
        "file_browser": True,
        "push_notifications": True,
        "offline_queue": True,
        "biometric_unlock": True,
        "team_sharing": True,
        "audit_logs": True,
    },
}


def detect_client_type(request: Request) -> str:
    explicit = request.headers.get("X-Client-Type")
    if explicit in ("ios", "android", "web"):
        return explicit
    ua = request.headers.get("User-Agent", "")
    if "iPhone" in ua or "iPad" in ua:
        return "ios"
    if "Android" in ua:
        return "android"
    return "web"


def get_capabilities(client_type: str, tier: str) -> dict:
    key = client_type if client_type == "web" else f"native_{tier}"
    return CAPABILITIES.get(key, CAPABILITIES["web"])


def require_capability(capability: str):
    def decorator(endpoint):
        async def wrapper(request: Request, *args, **kwargs):
            client_type = getattr(request.state, "client_type", "web")
            tier = getattr(request.state, "tier", "free")
            caps = get_capabilities(client_type, tier)
            if not caps.get(capability, False):
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail=f"{capability} requires subscription upgrade",
                )
            return await endpoint(request, *args, **kwargs)

        return wrapper

    return decorator
