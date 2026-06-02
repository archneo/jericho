import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request, HTTPException, status
from fastapi.responses import FileResponse

from auth_jwt import verify_token
from config import DB_PATH
from deps import require_auth
from worker import get_cached_dir, cache_dir

router = APIRouter()


@router.get("/api/web/projects")
async def list_projects(request: Request, path: str = "/srv"):
    require_auth(request)
    base = Path("/").resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    if not target.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Path not found")
    if not target.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a directory")

    cached = get_cached_dir(str(target))
    if cached:
        entries, updated_at = cached
        return {
            "path": str(target),
            "parent": str(target.parent) if target != base else None,
            "entries": entries,
            "cached": True,
            "cached_at": updated_at,
        }

    entries = []
    try:
        for entry in target.iterdir():
            name = entry.name
            if name.startswith("."):
                continue
            stat = entry.stat()
            entries.append({
                "name": name,
                "path": str(entry),
                "type": "directory" if entry.is_dir() else "file",
                "size": stat.st_size if entry.is_file() else None,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    except PermissionError:
        pass

    entries.sort(key=lambda e: (0 if e["type"] == "directory" else 1, e["name"].lower()))
    cache_dir(str(target), entries)

    return {
        "path": str(target),
        "parent": str(target.parent) if target != base else None,
        "entries": entries,
    }


@router.get("/api/web/download")
async def download_file(request: Request, path: str):
    require_auth(request)
    base = Path("/").resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return FileResponse(target, filename=target.name)


@router.get("/api/web/preview")
async def preview_file(request: Request, path: str):
    require_auth(request)
    base = Path("/").resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    MAX_PREVIEW = 1024 * 1024
    size = target.stat().st_size
    name = target.name.lower()

    if name.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp")):
        with open(target, "rb") as f:
            data = f.read()
        mime = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
            ".bmp": "image/bmp",
        }.get(Path(name).suffix, "application/octet-stream")
        b64 = base64.b64encode(data).decode("utf-8")
        return {
            "name": target.name,
            "type": "image",
            "size": size,
            "content": f"data:{mime};base64,{b64}",
        }

    text_exts = (
        ".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".toml",
        ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss",
        ".sh", ".bash", ".zsh", ".fish", ".ps1",
        ".go", ".rs", ".java", ".kt", ".scala", ".clj",
        ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
        ".rb", ".php", ".pl", ".pm", ".lua", ".r",
        ".sql", ".graphql", ".prisma",
        ".dockerfile", ".nginx", ".conf", ".cfg", ".ini",
        ".log", ".csv", ".tsv",
        ".xml", ".svg",
    )
    if name.endswith(text_exts) or size < 4096:
        try:
            with open(target, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(MAX_PREVIEW)
            ftype = "markdown" if name.endswith((".md", ".markdown")) else (
                "json" if name.endswith(".json") else (
                    "code" if name.endswith(text_exts) else "text"
                )
            )
            language = {
                ".py": "python", ".js": "javascript", ".ts": "typescript",
                ".sh": "bash", ".go": "go", ".rs": "rust", ".java": "java",
                ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
                ".php": "php", ".rb": "ruby", ".sql": "sql",
                ".html": "html", ".css": "css", ".scss": "scss",
                ".yaml": "yaml", ".yml": "yaml", ".json": "json",
                ".xml": "xml", ".nginx": "nginx", ".conf": "ini",
                ".dockerfile": "dockerfile", ".md": "markdown",
                ".log": "log", ".csv": "csv", ".txt": "text",
            }.get(Path(name).suffix, "")
            return {
                "name": target.name,
                "type": ftype,
                "language": language,
                "size": size,
                "content": content,
                "truncated": size > MAX_PREVIEW,
            }
        except Exception:
            pass

    return {
        "name": target.name,
        "type": "binary",
        "size": size,
        "content": "Binary file — preview not available",
    }


@router.post("/api/web/mkdir")
async def mkdir_endpoint(request: Request):
    require_auth(request)
    body = await request.json()
    path = body.get("path", "")
    if not path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing path")
    base = Path("/srv").resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Path traversal blocked")
    try:
        os.makedirs(target, exist_ok=True)
        return {"ok": True, "path": str(target)}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
