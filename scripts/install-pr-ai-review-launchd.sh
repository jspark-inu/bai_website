#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${BAI_WEBSITE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LABEL="${BAI_AI_REVIEW_LABEL:-com.user.bai-pr-ai-review}"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$REPO_DIR/.deploy-logs"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${REPO_DIR}/scripts/run-pr-ai-review.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/pr-ai-review-launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/pr-ai-review-launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"
echo "Installed ${LABEL} at ${PLIST}"
