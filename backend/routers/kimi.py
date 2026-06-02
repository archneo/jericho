import json
import subprocess
import urllib.request
from pathlib import Path

import yaml
from fastapi import APIRouter, Request, HTTPException, status

from auth_jwt import verify_token
from cache import cached
from config import HOST_BRIDGE_URL
from deps import audit, require_auth

router = APIRouter()

PLATFORMS_YAML = Path("/srv/jericho/agent-platforms.yaml")


def load_platforms():
    try:
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
                health_status = resp.status
        except Exception:
            health_status = 0
        active.append({
            "id": p["id"],
            "name": p["name"],
            "icon": p["icon"],
            "description": p["description"],
            "category": p.get("category", "general"),
            "status": "online" if health_status == 200 else "offline",
            "url": p["proxy_path"],
        })
    return active


@router.get("/api/web/platforms")
async def list_platforms(request: Request):
    require_auth(request)
    return cached("platforms", ttl=60, fn=_fetch_platforms)


@router.get("/api/web/kimi/sessions")
async def kimi_sessions(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    try:
        result = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", "--connect-timeout", "3", f"{HOST_BRIDGE_URL}/sessions"],
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


@router.post("/api/web/kimi/sessions/{uuid}/launch")
async def kimi_launch(request: Request, uuid: str):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    ip = request.client.host if request.client else "unknown"
    try:
        result = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", "-X", "POST", "--connect-timeout", "3", f"{HOST_BRIDGE_URL}/launch/{uuid}"],
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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/api/web/kimi/sessions/{port}/stop")
async def kimi_stop(request: Request, port: int):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    ip = request.client.host if request.client else "unknown"
    try:
        result = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", "-X", "POST", "--connect-timeout", "3", f"{HOST_BRIDGE_URL}/stop/{port}"],
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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
