#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${BAI_WEBSITE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LIVE_WEB_DIR="${BAI_LIVE_WEB_DIR:-/Users/hai_1/AI-Workspace/code/projects/dev/1C38-lab-feed/apps/web}"
LAUNCHD_LABEL="${BAI_NEXT_LAUNCHD_LABEL:-com.user.bai-next}"
LIVE_BACKEND_DIR="${BAI_LIVE_BACKEND_DIR:-/Users/hai_1/AI-Workspace/code/projects/dev/1C38-lab-feed/backend}"
BACKEND_LAUNCHD_LABEL="${BAI_BACKEND_LAUNCHD_LABEL:-com.user.baifeed}"

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

# The Next app proxies legacy APIs to the local Flask service.  Keep that
# service on the same merged revision; otherwise a merged backend feature can
# silently remain unavailable while the Next UI has already redeployed.
rsync -a --delete \
  --exclude 'venv/' \
  --exclude 'backups/' \
  --exclude '*.db' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite3' \
  "$REPO_DIR/backend/" "$LIVE_BACKEND_DIR/"
rsync -a --delete "$REPO_DIR/frontend/" "$(dirname "$LIVE_BACKEND_DIR")/frontend/"

cd "$LIVE_WEB_DIR"
npm ci
npm run typecheck
npm test
npm run build

launchctl kickstart -k "gui/$(id -u)/${LAUNCHD_LABEL}"
launchctl kickstart -k "gui/$(id -u)/${BACKEND_LAUNCHD_LABEL}"
curl -fsSI https://bai.haiinu.com/login >/dev/null
BACKEND_WALL_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:5066/api/wall)"
test "$BACKEND_WALL_STATUS" = "401"
echo "Deployed $(git -C "$REPO_DIR" rev-parse --short HEAD) to https://bai.haiinu.com"
