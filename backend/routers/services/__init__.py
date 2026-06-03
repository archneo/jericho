from fastapi import APIRouter

router = APIRouter()

from . import docker, local, public, tailscale  # noqa: E402, F401
