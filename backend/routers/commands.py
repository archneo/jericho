import shutil

from fastapi import APIRouter, Request
from utils.deps import require_auth

router = APIRouter()

COMMAND_REGISTRY = {
    "system": [
        {
            "id": "df_h",
            "command": "df -h",
            "description": "Disk usage",
            "icon": "💾",
            "dangerous": False,
        },
        {
            "id": "free_m",
            "command": "free -m",
            "description": "Memory usage",
            "icon": "🧠",
            "dangerous": False,
        },
        {
            "id": "uptime",
            "command": "uptime",
            "description": "System uptime",
            "icon": "⏱️",
            "dangerous": False,
        },
        {
            "id": "ps_aux",
            "command": "ps aux --sort=-%cpu | head -20",
            "description": "Top processes",
            "icon": "📈",
            "dangerous": False,
        },
        {
            "id": "whoami",
            "command": "whoami",
            "description": "Current user",
            "icon": "👤",
            "dangerous": False,
        },
        {
            "id": "uname_a",
            "command": "uname -a",
            "description": "Kernel info",
            "icon": "🐧",
            "dangerous": False,
        },
    ],
    "network": [
        {
            "id": "ip_addr",
            "command": "ip addr",
            "description": "IP addresses",
            "icon": "🌐",
            "dangerous": False,
        },
        {
            "id": "ss_tlnp",
            "command": "ss -tlnp",
            "description": "Listening ports",
            "icon": "🔌",
            "dangerous": False,
        },
        {
            "id": "ping_gw",
            "command": "ping -c 3 8.8.8.8",
            "description": "Ping Google DNS",
            "icon": "📡",
            "dangerous": False,
        },
    ],
    "docker": [
        {
            "id": "docker_ps",
            "command": "docker ps",
            "description": "Running containers",
            "icon": "🐳",
            "dangerous": False,
        },
        {
            "id": "docker_images",
            "command": "docker images",
            "description": "Docker images",
            "icon": "📦",
            "dangerous": False,
        },
        {
            "id": "docker_stats",
            "command": "docker stats --no-stream",
            "description": "Container stats",
            "icon": "📊",
            "dangerous": False,
        },
        {
            "id": "docker_compose_ps",
            "command": "docker compose ps",
            "description": "Compose services",
            "icon": "🎼",
            "dangerous": False,
        },
        {
            "id": "docker_logs",
            "command": "docker logs --tail 50 $(docker ps -q | head -1)",
            "description": "Latest container logs",
            "icon": "📜",
            "dangerous": False,
        },
        {
            "id": "docker_prune",
            "command": "docker system prune -f",
            "description": "Prune Docker (DANGER)",
            "icon": "⚠️",
            "dangerous": True,
        },
    ],
    "git": [
        {
            "id": "git_status",
            "command": "git status",
            "description": "Git status",
            "icon": "🌿",
            "dangerous": False,
        },
        {
            "id": "git_log",
            "command": "git log --oneline -10",
            "description": "Recent commits",
            "icon": "📜",
            "dangerous": False,
        },
        {
            "id": "git_branch",
            "command": "git branch -a",
            "description": "All branches",
            "icon": "🌲",
            "dangerous": False,
        },
    ],
    "sudo": [
        {
            "id": "nginx_reload",
            "command": "sudo nginx -s reload",
            "description": "Reload Nginx config",
            "icon": "🔄",
            "dangerous": True,
            "sudo": True,
        },
        {
            "id": "nginx_test",
            "command": "sudo nginx -t",
            "description": "Test Nginx config",
            "icon": "✅",
            "dangerous": False,
            "sudo": True,
        },
        {
            "id": "systemctl_restart_nginx",
            "command": "sudo systemctl restart nginx",
            "description": "Restart Nginx service",
            "icon": "🔄",
            "dangerous": True,
            "sudo": True,
        },
        {
            "id": "systemctl_status",
            "command": "sudo systemctl status nginx",
            "description": "Check Nginx service status",
            "icon": "📊",
            "dangerous": False,
            "sudo": True,
        },
        {
            "id": "docker_compose_up",
            "command": "sudo docker compose up -d",
            "description": "Start Docker Compose",
            "icon": "🐳",
            "dangerous": False,
            "sudo": True,
        },
        {
            "id": "docker_compose_restart",
            "command": "sudo docker compose restart",
            "description": "Restart Docker Compose",
            "icon": "🔄",
            "dangerous": True,
            "sudo": True,
        },
        {
            "id": "pacman_update",
            "command": "sudo pacman -Syu --noconfirm",
            "description": "Update system packages",
            "icon": "📦",
            "dangerous": True,
            "sudo": True,
        },
        {
            "id": "tailscale_up",
            "command": "sudo tailscale up",
            "description": "Start Tailscale",
            "icon": "🔗",
            "dangerous": False,
            "sudo": True,
        },
        {
            "id": "ufw_status",
            "command": "sudo ufw status",
            "description": "Check UFW firewall status",
            "icon": "🔥",
            "dangerous": False,
            "sudo": True,
        },
        {
            "id": "ss_listening",
            "command": "sudo ss -tlnp",
            "description": "List listening ports",
            "icon": "🔌",
            "dangerous": False,
            "sudo": True,
        },
    ],
    "dangerous": [
        {
            "id": "reboot",
            "command": "sudo reboot",
            "description": "Reboot server",
            "icon": "🔴",
            "dangerous": True,
        },
        {
            "id": "shutdown",
            "command": "sudo shutdown now",
            "description": "Shutdown server",
            "icon": "⛔",
            "dangerous": True,
        },
    ],
}

SHORTCUTS = {
    "deploy": {
        "name": "Deploy",
        "description": "Pull latest code and redeploy containers",
        "icon": "🚀",
        "dangerous": False,
        "steps": [
            {"cmd": "git pull origin main", "label": "Pull code"},
            {"cmd": "docker build -t app:latest .", "label": "Build image"},
            {"cmd": "docker compose up -d", "label": "Start containers"},
        ],
    },
    "update": {
        "name": "Update System",
        "description": "Update package lists and upgrade packages",
        "icon": "📦",
        "dangerous": False,
        "steps": [
            {"cmd": "sudo apt update", "label": "Update lists"},
            {"cmd": "sudo apt upgrade -y", "label": "Upgrade packages"},
        ],
    },
    "clean": {
        "name": "Clean Docker",
        "description": "Prune unused Docker images and volumes",
        "icon": "🧹",
        "dangerous": True,
        "steps": [
            {"cmd": "docker system prune -f", "label": "Prune images"},
            {"cmd": "docker volume prune -f", "label": "Prune volumes"},
        ],
    },
    "status": {
        "name": "Quick Status",
        "description": "Show system overview",
        "icon": "📊",
        "dangerous": False,
        "steps": [
            {"cmd": "uptime", "label": "Uptime"},
            {"cmd": "df -h", "label": "Disk usage"},
            {"cmd": "free -m", "label": "Memory"},
        ],
    },
}


@router.get("/api/web/commands")
async def list_commands(request: Request):
    require_auth(request)
    result = {}
    tools_detected = []
    for category, commands in COMMAND_REGISTRY.items():
        visible = []
        for cmd in commands:
            visible.append(cmd)
        if visible:
            result[category] = visible
    tool_map = {
        "docker": "docker",
        "git": "git",
        "kubectl": "kubectl",
        "npm": "npm",
        "pip": "pip",
        "pm2": "pm2",
        "nginx": "nginx",
        "terraform": "terraform",
        "ansible": "ansible",
    }
    for tool, binary in tool_map.items():
        if shutil.which(binary):
            tools_detected.append(tool)
    return {"categories": result, "tools_detected": tools_detected}


@router.get("/api/web/shortcuts")
async def list_shortcuts(request: Request):
    require_auth(request)
    return {"shortcuts": SHORTCUTS}
