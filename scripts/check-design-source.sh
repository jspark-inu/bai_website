#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! cmp -s frontend/app.css apps/web/public/static/app.css; then
  echo "frontend/app.css and apps/web/public/static/app.css differ."
  echo "The live Next app serves apps/web/public/static/app.css."
  echo "Apply the same CSS there before opening or merging the PR."
  exit 1
fi

if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
  git fetch --no-tags --depth=100 origin "${GITHUB_BASE_REF}:${GITHUB_BASE_REF}" >/dev/null 2>&1 || true
  BASE_REF="${GITHUB_BASE_REF}"
  CHANGED="$(git diff --name-only "${BASE_REF}...HEAD" || true)"

  if printf '%s\n' "$CHANGED" | grep -q '^frontend/'; then
    if ! printf '%s\n' "$CHANGED" | grep -Eq '^(apps/web/public/static/|apps/web/src/)'; then
      echo "This PR changes frontend/ only."
      echo "bai.haiinu.com is served by the Next app in apps/web/, so frontend-only PRs will not appear on the live site."
      echo "Move the same design change to apps/web/public/static/ or apps/web/src/."
      exit 1
    fi
  fi
fi

echo "Design source check passed."
