import json
import re
import socket
import subprocess
from pathlib import Path

import yaml
from fastapi import APIRouter, Request, HTTPException, status

from auth_jwt import verify_token
from cache import cached
from config import LOCALHOST_IPS
from deps import require_auth

router = APIRouter()


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
            if ip in LOCALHOST_IPS:
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


@router.get("/api/web/services/local")
async def local_services(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    return cached("local_services", ttl=15, fn=_fetch_local_services)


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


@router.get("/api/web/docker/containers")
async def docker_containers(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    return cached("docker_containers", ttl=15, fn=_fetch_docker_containers)


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


@router.get("/api/web/tailscale/peers")
async def tailscale_peers(request: Request):
    require_auth(request)
    return cached("tailscale_peers", ttl=30, fn=_fetch_tailscale_peers)
