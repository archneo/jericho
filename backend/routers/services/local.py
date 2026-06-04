import json
import os
import subprocess

from fastapi import Request
from routers.services import router
from utils.auth_jwt import verify_token
from utils.cache import cached
from utils.deps import require_auth

from config import JERICHO_PUBLIC_HOST


def _is_local_ip(ip: str) -> bool:
    ip = ip.split("%")[0]
    return ip.startswith("127.") or ip == "::1" or ip == "[::1]" or ip in ("0.0.0.0", "*")


def _fetch_tailscale_self() -> tuple[str, str]:
    """Dynamically resolve this host's Tailscale IP and hostname from the local API.
    Returns (ip, hostname).
    """
    try:
        result = subprocess.run(
            [
                "curl",
                "-s",
                "--unix-socket",
                "/run/tailscale/tailscaled.sock",
                "http://local-tailscaled.sock/localapi/v0/status",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        data = json.loads(result.stdout)
        self_peer = data.get("Self", {})
        ips = self_peer.get("TailscaleIPs", [])
        ip = ips[0] if ips else ""
        hostname = self_peer.get("HostName", "")
        return ip, hostname
    except Exception:
        pass
    # Fallback to env var
    return os.environ.get("TAILSCALE_IP", ""), ""


def _fetch_local_services():
    services = []
    # Pre-resolve Tailscale identity once per scan
    tailscale_ip, tailscale_hostname = _fetch_tailscale_self()

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

            # Build URLs
            if _is_local_ip(ip):
                local_url = f"http://127.0.0.1:{port}"
                tailscale_url = f"http://{tailscale_ip}:{port}" if tailscale_ip else ""
            else:
                local_url = f"http://{ip}:{port}"
                tailscale_url = f"http://{tailscale_ip}:{port}" if tailscale_ip else ""

            # "accessible" means binds to 0.0.0.0 or Tailscale IP directly
            accessible = ip in ("0.0.0.0", "*") or (tailscale_ip and ip == tailscale_ip)

            services.append({
                "port": port,
                "ip": ip,
                "local_url": local_url,
                "tailscale_url": tailscale_url,
                "process": "",
                "accessible": accessible,
                "tailscale_ip": tailscale_ip,
                "tailscale_hostname": tailscale_hostname,
            })
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
                services.append({
                    "port": 0, "ip": "docker", "local_url": "", "tailscale_url": "",
                    "process": name, "ports": ports, "accessible": False,
                })
    except Exception:
        pass

    return services


def _enrich_with_proxy_urls(services: list) -> list:
    """Attach proxy_url to each service using the configured public host."""
    # Determine the public base URL for proxy access
    # Priority: env var > Tailscale IP:9000 (nginx port)
    public_host = JERICHO_PUBLIC_HOST
    if not public_host:
        # Try to extract Tailscale IP from first service that has it
        for s in services:
            ts_ip = s.get("tailscale_ip")
            if ts_ip:
                public_host = f"{ts_ip}:9000"
                break
    if not public_host:
        public_host = "localhost:9000"

    enriched = []
    for s in services:
        if s.get("ip") == "docker":
            enriched.append(s)
            continue
        port = s.get("port", 0)
        proxy_url = ""
        if port > 0:
            proxy_url = f"http://{public_host}/api/web/proxy/{port}/"
        s["proxy_url"] = proxy_url
        enriched.append(s)
    return enriched


@router.get("/api/web/services/local")
async def local_services(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    services = cached("local_services", ttl=15, fn=_fetch_local_services)
    return _enrich_with_proxy_urls(services)
