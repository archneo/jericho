# routers/services/proxy.py — Authenticated generic proxy for localhost/Tailscale services
# BotFather-style gateway: token authenticates, Jericho routes to backend service
import ipaddress

import aiohttp
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from routers.services import router
from utils.auth_jwt import get_auth_from_request
from utils.ratelimit import get_rate_limiter

# ─── SSRF Protection Configuration ────────────────────────────────────────────
_ALLOWED_NETWORKS = [
    ipaddress.ip_network("127.0.0.1/32"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("100.64.0.0/10"),  # Tailscale CGNAT
]

_BLOCKED_PORTS = {
    22, 25, 53, 110, 143, 3306, 5432, 6379,
    9001, 9002, 9003, 9004, 9998, 9999,
}

_HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
}

_FORWARD_REQ_HEADERS = {
    "accept", "accept-encoding", "accept-language", "authorization",
    "cache-control", "content-encoding", "content-language",
    "content-length", "content-type", "cookie", "dnt", "host",
    "if-match", "if-modified-since", "if-none-match", "if-range",
    "if-unmodified-since", "origin", "pragma", "range", "referer",
    "user-agent", "x-csrf-token", "x-forwarded-for",
    "x-forwarded-host", "x-forwarded-proto", "x-requested-with",
}

_FORWARD_RESP_HEADERS = {
    "access-control-allow-credentials", "access-control-allow-headers",
    "access-control-allow-methods", "access-control-allow-origin",
    "access-control-expose-headers", "access-control-max-age",
    "cache-control", "content-disposition", "content-encoding",
    "content-language", "content-length", "content-range",
    "content-security-policy", "content-type", "etag", "expires",
    "last-modified", "location", "permissions-policy",
    "referrer-policy", "set-cookie", "strict-transport-security",
    "x-content-type-options", "x-frame-options", "x-xss-protection",
}


def _is_allowed_destination(port: int, ip: str = "127.0.0.1") -> bool:
    if port in _BLOCKED_PORTS or port < 1 or port > 65535:
        return False
    try:
        addr = ipaddress.ip_address(ip.split("%")[0])
        return any(addr in net for net in _ALLOWED_NETWORKS)
    except ValueError:
        return False


def _filter_request_headers(headers) -> dict:
    result = {}
    for key, value in headers.items():
        k = key.lower()
        if k not in _HOP_HEADERS and k in _FORWARD_REQ_HEADERS:
            result[key] = value
    return result


def _filter_response_headers(headers) -> dict:
    result = {}
    for key, value in headers.items():
        k = key.lower()
        if k not in _HOP_HEADERS and k in _FORWARD_RESP_HEADERS:
            result[key] = value
    return result


def _get_proxy_target(port: int, path: str) -> str:
    target_path = path if path.startswith("/") else "/" + path
    return f"http://127.0.0.1:{port}{target_path}"


_PROXY_RATE = 1 / 6
_PROXY_BURST = 20


def _check_proxy_rate(user_id: str):
    bucket = get_rate_limiter(f"proxy:{user_id}", rate=_PROXY_RATE, burst=_PROXY_BURST)
    if not bucket.allow():
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Proxy rate limit exceeded. Slow down.",
        )


@router.api_route(
    "/api/web/proxy/{port}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def proxy_service(request: Request, port: int, path: str = ""):
    """
    Authenticated generic proxy for localhost and Tailscale services.

    Access any listening TCP service through Jericho's JWT auth layer.
    SSRF-protected, rate-limited, streaming-capable.
    """
    try:
        token_data = get_auth_from_request(request)
    except HTTPException:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to access proxied services",
        )
    user_id = token_data.get("sub", "anonymous")
    _check_proxy_rate(user_id)

    if not _is_allowed_destination(port):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Port {port} is not allowed for proxying",
        )

    target = _get_proxy_target(port, path)

    conn_header = request.headers.get("connection", "").lower()
    upgrade_header = request.headers.get("upgrade", "").lower()
    if "upgrade" in conn_header and "websocket" in upgrade_header:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="WebSocket proxying not yet supported. Use nginx routes for WS services.",
        )

    body = await request.body()
    headers = _filter_request_headers(request.headers)
    headers["X-Forwarded-For"] = request.client.host if request.client else "unknown"
    headers["X-Forwarded-Proto"] = request.url.scheme
    headers["X-Forwarded-Host"] = request.headers.get("host", "")
    headers["X-Jericho-User"] = user_id

    timeout = aiohttp.ClientTimeout(total=30, connect=5)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        try:
            async with session.request(
                method=request.method,
                url=target,
                headers=headers,
                data=body or None,
                allow_redirects=False,
            ) as resp:

                async def stream_response():
                    async for chunk in resp.content.iter_chunked(8192):
                        yield chunk

                return StreamingResponse(
                    stream_response(),
                    status_code=resp.status,
                    headers=_filter_response_headers(resp.headers),
                )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Proxy error: {type(exc).__name__}",
            )
