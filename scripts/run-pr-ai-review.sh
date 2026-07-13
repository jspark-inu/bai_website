#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/Users/hai_1/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="${BAI_WEBSITE_REPO:-/Users/hai_1/AI-Workspace/code/projects/dev/bai_website}"
LOG_DIR="${BAI_AI_REVIEW_LOG_DIR:-$REPO_DIR/.deploy-logs}"

mkdir -p "$LOG_DIR"
cd "$REPO_DIR"
exec node scripts/pr-ai-review-worker.mjs >>"$LOG_DIR/pr-ai-review.log" 2>&1
