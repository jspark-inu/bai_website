#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${BAI_WEBSITE_REPO:-/Users/hai_1/AI-Workspace/code/projects/dev/bai_website}"
LOG_DIR="${BAI_DEPLOY_LOG_DIR:-$REPO_DIR/.deploy-logs}"
LOCK_DIR="${BAI_DEPLOY_LOCK_DIR:-/tmp/bai-website-autodeploy.lock}"
WORKTREE_DIR="${BAI_DEPLOY_WORKTREE:-/Users/hai_1/AI-Workspace/code/runtime/deploy-worktrees/bai_website-main}"
STATE_DIR="${BAI_DEPLOY_STATE_DIR:-/Users/hai_1/AI-Workspace/code/runtime/deploy-state}"
DEPLOYED_HEAD_FILE="$STATE_DIR/bai_website-main.head"

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

REMOTE_HEAD="$(git rev-parse origin/main)"
DEPLOYED_HEAD="$(cat "$DEPLOYED_HEAD_FILE" 2>/dev/null || true)"
if [[ "$DEPLOYED_HEAD" == "$REMOTE_HEAD" ]]; then
  echo "Already deployed at ${REMOTE_HEAD:0:7}."
  exit 0
fi

mkdir -p "$(dirname "$WORKTREE_DIR")" "$STATE_DIR"
if [[ ! -e "$WORKTREE_DIR/.git" ]]; then
  git worktree add --detach "$WORKTREE_DIR" "$REMOTE_HEAD"
else
  if [[ -n "$(git -C "$WORKTREE_DIR" status --porcelain)" ]]; then
    echo "Deploy worktree is dirty; refusing to overwrite it."
    git -C "$WORKTREE_DIR" status --short
    exit 1
  fi
  git -C "$WORKTREE_DIR" fetch origin main
  git -C "$WORKTREE_DIR" checkout --detach "$REMOTE_HEAD"
fi

BAI_WEBSITE_REPO="$WORKTREE_DIR" "$WORKTREE_DIR/scripts/deploy-react-to-live.sh"
printf '%s\n' "$REMOTE_HEAD" > "$DEPLOYED_HEAD_FILE"
echo "Deployed ${REMOTE_HEAD:0:7} from isolated worktree."
