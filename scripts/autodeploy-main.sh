#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${BAI_WEBSITE_REPO:-/Users/hai_1/AI-Workspace/10-working/1C-개발/bai_website}"
LOG_DIR="${BAI_DEPLOY_LOG_DIR:-$REPO_DIR/.deploy-logs}"
LOCK_DIR="${BAI_DEPLOY_LOCK_DIR:-/tmp/bai-website-autodeploy.lock}"

mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/autodeploy.log" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] autodeploy check"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another deploy is already running."
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

cd "$REPO_DIR"
git fetch origin main

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"

if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
  echo "Already current at ${LOCAL_HEAD:0:7}."
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty; refusing to auto-pull."
  git status --short
  exit 1
fi

git pull --ff-only origin main
"$REPO_DIR/scripts/deploy-react-to-live.sh"
