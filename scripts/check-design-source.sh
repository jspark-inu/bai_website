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

CHANGED=""
if [[ -n "${BAI_PR_BASE_SHA:-}" ]]; then
  HEAD_REF="${BAI_PR_HEAD_SHA:-HEAD}"
  git cat-file -e "${BAI_PR_BASE_SHA}^{commit}"
  git cat-file -e "${HEAD_REF}^{commit}"
  CHANGED="$(git diff --name-only "${BAI_PR_BASE_SHA}" "${HEAD_REF}")"
elif [[ -n "${GITHUB_BASE_REF:-}" ]]; then
  git fetch --no-tags origin \
    "refs/heads/${GITHUB_BASE_REF}:refs/remotes/origin/${GITHUB_BASE_REF}" >/dev/null
  CHANGED="$(git diff --name-only "origin/${GITHUB_BASE_REF}...HEAD")"
fi

if [[ -n "$CHANGED" ]]; then
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
