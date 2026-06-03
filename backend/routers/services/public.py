import contextlib
import json
import re
import socket
from pathlib import Path

import yaml
from fastapi import Request
from routers.services import router
from utils.auth_jwt import verify_token
from utils.cache import cached
from utils.deps import require_auth


def _discover_cloudflared_hosts():
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
                        with contextlib.suppress(ValueError, IndexError):
                            port = int(service.split("localhost:")[1].split("/")[0])
                    desc = f"Tunnel [{tunnel_name}]"
                    if path:
                        desc += f" → {service}{path}"
                    else:
                        desc += f" → {service}"
                    hosts.append(
                        {
                            "domain": hostname,
                            "url": f"https://{hostname}{path}" if path else f"https://{hostname}",
                            "port": port,
                            "source": "cloudflared",
                            "description": desc,
                        }
                    )
    except Exception as e:
        print(f"[discover] cloudflared error: {e}")
    return hosts


def _discover_nginx_hosts():
    hosts = []
    try:
        for conf_file in Path("/etc/nginx").rglob("*.conf"):
            text = conf_file.read_text()
            servers = re.findall(r"server\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}", text, re.DOTALL)
            for block in servers:
                listen_match = re.search(r"listen\s+(\d+)", block)
                server_name_match = re.search(r"server_name\s+([^;]+)", block)
                if listen_match and server_name_match:
                    port = int(listen_match.group(1))
                    names = server_name_match.group(1).strip().split()
                    for name in names:
                        if name in ("_", "default"):
                            continue
                        hosts.append(
                            {
                                "domain": name,
                                "url": f"https://{name}",
                                "port": port,
                                "source": "nginx",
                                "description": f"Nginx port {port}",
                            }
                        )
    except Exception as e:
        print(f"[discover] nginx error: {e}")
    return hosts


def _check_port_health(port, ip="127.0.0.1"):
    try:
        with socket.create_connection((ip, port), timeout=2):
            return True
    except Exception:
        return False


def _fetch_public_services():
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


@router.get("/api/web/services/public")
async def public_services(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    return cached("public_services", ttl=60, fn=_fetch_public_services)
