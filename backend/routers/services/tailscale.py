import json
import subprocess

from fastapi import Request
from routers.services import router
from utils.cache import cached
from utils.deps import require_auth


def _fetch_tailscale_peers():
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
        peers = []
        self_peer = data.get("Self", {})
        if self_peer:
            peers.append(
                {
                    "name": self_peer.get("HostName", "self"),
                    "ip": self_peer.get("TailscaleIPs", [""])[0],
                    "os": self_peer.get("OS", "?"),
                    "online": self_peer.get("Online", False),
                    "last_seen": self_peer.get("LastSeen", ""),
                    "is_self": True,
                }
            )
        for key, peer in data.get("Peer", {}).items():
            peers.append(
                {
                    "name": peer.get("HostName", key),
                    "ip": peer.get("TailscaleIPs", [""])[0],
                    "os": peer.get("OS", "?"),
                    "online": peer.get("Online", False),
                    "last_seen": peer.get("LastSeen", ""),
                    "is_self": False,
                }
            )
        return peers
    except Exception:
        return []


@router.get("/api/web/tailscale/peers")
async def tailscale_peers(request: Request):
    require_auth(request)
    return cached("tailscale_peers", ttl=30, fn=_fetch_tailscale_peers)
