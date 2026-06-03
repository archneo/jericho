import os
import subprocess

from fastapi import Request
from routers.services import router
from utils.auth_jwt import verify_token
from utils.cache import cached
from utils.deps import require_auth


def _is_local_ip(ip: str) -> bool:
    ip = ip.split("%")[0]
    return ip.startswith("127.") or ip == "::1" or ip == "[::1]" or ip in ("0.0.0.0", "*")


def _fetch_local_services():
    services = []
    try:
        result = subprocess.run(
            ["ss", "-tlnp"],
            capture_output=True,
            text=True,
            timeout=5,
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
            if _is_local_ip(ip):
                url = f"http://127.0.0.1:{port}"
            else:
                url = f"http://{os.environ.get('TAILSCALE_IP', '127.0.0.1')}:{port}"
            services.append({"port": port, "ip": ip, "url": url, "process": ""})
    except Exception:
        pass
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}\t{{.Ports}}"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        for line in result.stdout.splitlines():
            if "\t" in line:
                name, ports = line.split("\t", 1)
                services.append(
                    {"port": 0, "ip": "docker", "url": "", "process": name, "ports": ports}
                )
    except Exception:
        pass
    return services


@router.get("/api/web/services/local")
async def local_services(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    return cached("local_services", ttl=15, fn=_fetch_local_services)
