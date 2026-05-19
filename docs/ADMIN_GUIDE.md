# Admin Upload Guide

This guide explains how to upload the Jericho repository to GitHub — both the full hierarchical repo and the upload-ready sub-bucket.

---

## Prerequisites

1. A [GitHub](https://github.com) account
2. `git` installed on your server (`sudo pacman -S git` or `sudo apt install git`)
3. A GitHub personal access token (PAT) with `repo` scope, **or** SSH key configured

---

## Option A: Upload the Full Repo (Recommended)

The main repository at `/srv/jericho/github/` contains the complete hierarchical structure with full documentation.

### Step 1: Create a GitHub Repository

1. Go to https://github.com/new
2. Name it `jericho` (or any name you prefer)
3. Choose **Private** (recommended — contains your architecture details)
4. Do NOT initialize with README, .gitignore, or license (we already have these)
5. Click **Create repository**

### Step 2: Add Remote and Push

```bash
cd /srv/jericho/github

# Add your GitHub repo as remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/jericho.git

# Rename branch to main
git branch -M main

# Push everything
git push -u origin main
```

If using a Personal Access Token:
```bash
git remote add origin https://YOUR_USERNAME:YOUR_PAT@github.com/YOUR_USERNAME/jericho.git
git push -u origin main
```

If using SSH:
```bash
git remote add origin git@github.com:YOUR_USERNAME/jericho.git
git push -u origin main
```

### Step 3: Verify

- Open `https://github.com/YOUR_USERNAME/jericho`
- You should see all directories: `backend/`, `frontend/`, `bridge/`, `config/`, `docs/`, etc.
- The README should render with the Jericho logo and feature table

---

## Option B: Upload the Sub-Bucket Only

The `upload-ready/` folder is a **self-contained, minimal repository** designed for one-command creation. Use this if you want a clean repo without the full documentation overhead, or if you want to publish a public fork.

### Step 1: Copy the Sub-Bucket

```bash
# Copy to a temp location (do not upload from inside the main repo)
cp -r /srv/jericho/github/upload-ready /tmp/jericho-clean
cd /tmp/jericho-clean
```

### Step 2: Initialize and Push

```bash
# Initialize fresh git repo
git init
git add .
git commit -m "feat: Initial Jericho Command Center

- FastAPI backend with Argon2id + TOTP + JWT auth
- ttyd terminal + code-server IDE via nginx reverse proxy
- Go WebSocket PTY bridge for terminal streaming
- Host bridge for Kimi CLI session management
- PWA frontend with Service Worker, manifest, offline support
- Docker Compose orchestration with health checks
- Agent registry with platform definitions"

# Add remote and push
git remote add origin https://github.com/YOUR_USERNAME/jericho.git
git branch -M main
git push -u origin main
```

### Step 3: Verify

Same as Option A — check that the repo renders correctly on GitHub.

---

## Option C: One-Liner Upload Script

Save this as `upload.sh` and run it:

```bash
#!/bin/bash
# One-command GitHub upload for Jericho

set -e

REPO_URL="${1:-https://github.com/YOUR_USERNAME/jericho.git}"
MODE="${2:-full}"   # 'full' or 'sub'

if [ "$MODE" = "full" ]; then
    cd /srv/jericho/github
    git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
    git branch -M main
    git push -u origin main
    echo "✅ Full repo pushed to $REPO_URL"
else
    TMPDIR=$(mktemp -d)
    cp -r /srv/jericho/github/upload-ready/* "$TMPDIR/"
    cd "$TMPDIR"
    git init
    git add .
    git commit -m "feat: Initial Jericho Command Center"
    git remote add origin "$REPO_URL"
    git branch -M main
    git push -u origin main
    echo "✅ Sub-bucket pushed to $REPO_URL"
    rm -rf "$TMPDIR"
fi
```

Usage:
```bash
# Upload full repo
bash upload.sh https://github.com/YOUR_USERNAME/jericho.git full

# Upload sub-bucket only
bash upload.sh https://github.com/YOUR_USERNAME/jericho-mini.git sub
```

---

## Post-Upload Workflow

### Keeping GitHub in Sync

After making changes to `/srv/jericho/`, update the GitHub repo:

```bash
cd /srv/jericho/github

# Stage all changes
git add -A

# Commit with conventional message
git commit -m "fix: update nginx config for new service route"

# Push
git push origin main
```

### Two-Way Sync (Clone → Server)

If you edit files on GitHub (e.g., via web UI or another machine), pull them back:

```bash
cd /srv/jericho/github
git pull origin main

# Then copy changed files back to live locations
sudo cp config/nginx/jericho.conf /etc/nginx/jericho.conf
sudo nginx -s reload
docker compose up -d --build
```

### What NOT to Commit

These are gitignored and should never be pushed:
- `.env` (contains real secrets)
- `data/` (databases and logs)
- `__pycache__/` (Python bytecode)
- Compiled binaries (`terminal-bridge`)

If you accidentally commit secrets:
1. Rotate the secrets immediately (`scripts/setup.sh`)
2. Use [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) or `git filter-branch` to purge from history
3. Force-push the cleaned history: `git push --force origin main`

---

## Repository Visibility

| Scenario | Visibility |
|----------|-----------|
| Personal homelab, private configs | **Private** |
| Sharing with team members | **Private** + invite collaborators |
| Open-source release (sanitized) | **Public** — ensure all secrets are `YOUR_*` placeholders |

To change visibility after upload:
1. Go to GitHub repo → Settings → General → Danger Zone
2. Click "Change visibility" → Make private/public

---

## Next Steps After Upload

1. **Enable GitHub Discussions** for community Q&A (Settings → Discussions)
2. **Add topics** to your repo: `homelab`, `self-hosted`, `fastapi`, `docker`, `pwa`
3. **Pin the repo** on your GitHub profile for visibility
4. **Set up branch protection** (Settings → Branches → Add rule for `main`)
5. **Enable Dependabot** for automated dependency updates

---

*Happy uploading! 🚀*
