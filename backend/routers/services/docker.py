import subprocess

from fastapi import Request
from routers.services import router
from utils.auth_jwt import verify_token
from utils.cache import cached
from utils.deps import require_auth


def _fetch_docker_containers():
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        containers = []
        for line in result.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) >= 3:
                containers.append(
                    {
                        "id": parts[0][:12],
                        "name": parts[1],
                        "status": parts[2],
                        "image": parts[3] if len(parts) > 3 else "",
                    }
                )
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
