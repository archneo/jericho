from fastapi import APIRouter

router = APIRouter()

from . import docker, local, proxy, public, tailscale  # noqa: E402, F401
