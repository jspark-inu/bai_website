#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${BAI_WEBSITE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LIVE_WEB_DIR="${BAI_LIVE_WEB_DIR:-/Users/hai_1/AI-Workspace/10-working/1C-개발/1C38-lab-feed/apps/web}"
LAUNCHD_LABEL="${BAI_NEXT_LAUNCHD_LABEL:-com.user.bai-next}"

cd "$REPO_DIR/apps/web"
npm ci
npm run typecheck
npm test
npm run build

rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude '.next/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '*.db' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite3' \
  --exclude '*.tsbuildinfo' \
  "$REPO_DIR/apps/web/" "$LIVE_WEB_DIR/"

cd "$LIVE_WEB_DIR"
npm ci
npm run typecheck
npm test
npm run build

launchctl kickstart -k "gui/$(id -u)/${LAUNCHD_LABEL}"
curl -fsSI https://bai.haiinu.com/login >/dev/null
echo "Deployed $(git -C "$REPO_DIR" rev-parse --short HEAD) to https://bai.haiinu.com"
