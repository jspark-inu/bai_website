#!/usr/bin/env bash
set -euo pipefail

# These filters protect live data even while rsync runs with --delete. Keep the
# broad sidecar patterns: SQLite rollback journals and WAL/SHM files are part of
# the live database and must never be removed independently of the main file.
WEB_STATIC_PRESERVE_ARGS=(
  --exclude 'node_modules/'
  --exclude '.next/'
  --exclude '.env'
  --exclude '.env.*'
  --exclude '*.db'
  --exclude '*.db-*'
  --exclude '*.sqlite'
  --exclude '*.sqlite-*'
  --exclude '*.sqlite3'
  --exclude '*.sqlite3-*'
  --exclude '*.tsbuildinfo'
)
BACKEND_STATIC_PRESERVE_ARGS=(
  --exclude 'venv/'
  --exclude 'backups/'
  --exclude 'uploads/'
  --exclude '.env'
  --exclude '.env.*'
  --exclude '*.db'
  --exclude '*.db-*'
  --exclude '*.db-journal'
  --exclude '*.db-wal'
  --exclude '*.db-shm'
  --exclude '*.sqlite'
  --exclude '*.sqlite-*'
  --exclude '*.sqlite-journal'
  --exclude '*.sqlite-wal'
  --exclude '*.sqlite-shm'
  --exclude '*.sqlite3'
  --exclude '*.sqlite3-*'
  --exclude '*.sqlite3-journal'
  --exclude '*.sqlite3-wal'
  --exclude '*.sqlite3-shm'
)

die() {
  echo "ERROR: $*" >&2
  exit 1
}

main() {
  local repo_dir live_web_dir launchd_label live_backend_dir backend_launchd_label
  local live_db_path live_backup_dir live_upload_dir python_bin initial_install_override
  local live_db_basename live_backup_relative live_upload_relative backend_wall_status
  local web_db_relative web_backup_relative web_upload_relative proxy_health_status
  local proxy_me_status runtime_db_fingerprint runtime_upload_fingerprint
  local live_frontend_dir rollback_root rollback_snapshot rollback_build_status
  local runtime_env_file api_origin next_origin required_name
  local rollback_armed=0
  local initial_install=0
  local -a web_preserve_args backend_preserve_args

  runtime_env_file="${BAI_RUNTIME_ENV_FILE:-/Users/hai_1/AI-Workspace/code/runtime/config/bai-website.env}"
  if [[ -e "$runtime_env_file" || -L "$runtime_env_file" ]]; then
    [[ -f "$runtime_env_file" && -r "$runtime_env_file" && ! -L "$runtime_env_file" ]] || \
      die "BAI runtime env must be a readable regular file, not a symlink: $runtime_env_file"
    set -a
    # shellcheck disable=SC1090
    source "$runtime_env_file"
    set +a
  fi
  for required_name in LAB_FEED_DB BAI_UPLOAD_DIR BAI_LIVE_BACKUP_DIR BAI_ROLLBACK_DIR LAB_FEED_SECRET BAI_API_ORIGIN; do
    [[ -n "${!required_name:-}" ]] || die \
      "$required_name must be explicit in BAI_RUNTIME_ENV_FILE or the deploy environment"
  done
  if [[ "${#LAB_FEED_SECRET}" -lt 32 ]]; then
    die "LAB_FEED_SECRET must contain at least 32 characters"
  fi
  case "$LAB_FEED_SECRET" in
    dev|dev-insecure-secret|change-me-generate-with-python-secrets)
      die "LAB_FEED_SECRET is still a public development placeholder" ;;
  esac
  case "${LAB_FEED_COOKIE_SECURE:-}" in
    1|true|TRUE|yes|YES|on|ON) ;;
    *) die "LAB_FEED_COOKIE_SECURE=1 is required for live deployment" ;;
  esac

  repo_dir="${BAI_WEBSITE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  live_web_dir="${BAI_LIVE_WEB_DIR:-/Users/hai_1/AI-Workspace/code/projects/dev/1C38-lab-feed/apps/web}"
  launchd_label="${BAI_NEXT_LAUNCHD_LABEL:-com.user.bai-next}"
  live_backend_dir="${BAI_LIVE_BACKEND_DIR:-/Users/hai_1/AI-Workspace/code/projects/dev/1C38-lab-feed/backend}"
  live_frontend_dir="$(dirname "$live_backend_dir")/frontend"
  backend_launchd_label="${BAI_BACKEND_LAUNCHD_LABEL:-com.user.baifeed}"
  live_db_path="${LAB_FEED_DB:-$live_backend_dir/lab-feed.db}"
  live_backup_dir="${BAI_LIVE_BACKUP_DIR:-/Users/hai_1/AI-Workspace/code/runtime/backups/bai_website}"
  live_upload_dir="${BAI_UPLOAD_DIR:-$live_backend_dir/uploads}"
  python_bin="${BAI_BACKUP_PYTHON:-python3}"
  rollback_root="${BAI_ROLLBACK_DIR:-/Users/hai_1/AI-Workspace/code/runtime/rollbacks/bai_website}"
  api_origin="${BAI_API_ORIGIN%/}"
  next_origin="${BAI_NEXT_ORIGIN:-http://127.0.0.1:5067}"
  initial_install_override="${BAI_ALLOW_MISSING_LIVE_DB_FOR_INITIAL_INSTALL:-}"

  case "$api_origin" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) die "BAI_API_ORIGIN must use the local Flask service: $api_origin" ;;
  esac
  case "$next_origin" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) die "BAI_NEXT_ORIGIN must use the local Next service: $next_origin" ;;
  esac

  case "$live_db_path" in
    /*) ;;
    *) die "LAB_FEED_DB must be an absolute path: $live_db_path" ;;
  esac
  case "$live_web_dir" in
    /*) ;;
    *) die "BAI_LIVE_WEB_DIR must be an absolute path: $live_web_dir" ;;
  esac
  case "$live_backend_dir" in
    /*) ;;
    *) die "BAI_LIVE_BACKEND_DIR must be an absolute path: $live_backend_dir" ;;
  esac
  case "$live_backup_dir" in
    /*) ;;
    *) die "BAI_LIVE_BACKUP_DIR must be an absolute path: $live_backup_dir" ;;
  esac
  case "$live_upload_dir" in
    /*) ;;
    *) die "BAI_UPLOAD_DIR must be an absolute path: $live_upload_dir" ;;
  esac
  case "$rollback_root" in
    /*) ;;
    *) die "BAI_ROLLBACK_DIR must be an absolute path: $rollback_root" ;;
  esac
  if [[ "$live_upload_dir" == "$live_web_dir" || "$live_backup_dir" == "$live_web_dir" ]]; then
    die "runtime upload/backup directories cannot equal BAI_LIVE_WEB_DIR"
  fi
  if [[ "$live_upload_dir" == "$live_backend_dir" || "$live_backup_dir" == "$live_backend_dir" ]]; then
    die "runtime upload/backup directories cannot equal BAI_LIVE_BACKEND_DIR"
  fi

  # Fail closed before build or rsync. The override is intentionally verbose
  # and only permits a truly empty initial installation; this script itself
  # never creates a database.
  if [[ -f "$live_db_path" ]]; then
    :
  elif [[ "$initial_install_override" == "I_UNDERSTAND_THIS_CREATES_A_NEW_EMPTY_BAI_DATABASE" ]]; then
    if [[ -e "$live_db_path" || -L "$live_db_path" ]]; then
      die "initial-install override refused because the DB path exists but is not a regular file: $live_db_path"
    fi
    if [[ -d "$live_backend_dir" ]] && find "$live_backend_dir" -maxdepth 1 -type f \
      \( -name '*.db*' -o -name '*.sqlite*' -o -name '*.sqlite3*' \) -print -quit | grep -q .; then
      die "initial-install override refused because another SQLite database exists in $live_backend_dir"
    fi
    if [[ -d "$live_upload_dir" ]] && find "$live_upload_dir" -type f -print -quit | grep -q .; then
      die "initial-install override refused because existing uploads indicate this is not an empty installation"
    fi
    initial_install=1
    echo "WARNING: no live DB exists; explicit empty initial-install override accepted." >&2
  else
    die "live DB is missing: $live_db_path (refusing deployment without a verified online backup)"
  fi

  cd "$repo_dir/apps/web"
  npm ci
  npm run typecheck
  npm test
  npm run build

  # Recheck and snapshot immediately before the first live-directory mutation.
  # backup_db.py performs source quick_check, online backup, destination
  # integrity_check, fsync, and atomic publication; any failure stops deploy.
  if [[ "$initial_install" -eq 0 ]]; then
    "$python_bin" "$repo_dir/scripts/backup_db.py" \
      --db "$live_db_path" \
      --backup-dir "$live_backup_dir"
  fi

  web_preserve_args=("${WEB_STATIC_PRESERVE_ARGS[@]}")
  if [[ "$live_db_path" == "$live_web_dir/"* ]]; then
    web_db_relative="${live_db_path#"$live_web_dir/"}"
    web_preserve_args+=(--exclude "/$web_db_relative" --exclude "/$web_db_relative-*")
  fi
  if [[ "$live_backup_dir" == "$live_web_dir/"* ]]; then
    web_backup_relative="${live_backup_dir#"$live_web_dir/"}"
    web_preserve_args+=(--exclude "/$web_backup_relative/")
  fi
  if [[ "$live_upload_dir" == "$live_web_dir/"* ]]; then
    web_upload_relative="${live_upload_dir#"$live_web_dir/"}"
    web_preserve_args+=(--exclude "/$web_upload_relative/")
  fi

  # The Next app proxies legacy APIs to the local Flask service. Keep that
  # service on the same merged revision while preserving runtime data.
  backend_preserve_args=("${BACKEND_STATIC_PRESERVE_ARGS[@]}")
  if [[ "$(dirname "$live_db_path")" == "$live_backend_dir" ]]; then
    live_db_basename="$(basename "$live_db_path")"
    backend_preserve_args+=(--exclude "/$live_db_basename" --exclude "/$live_db_basename-*")
  fi
  if [[ "$live_backup_dir" == "$live_backend_dir/"* ]]; then
    live_backup_relative="${live_backup_dir#"$live_backend_dir/"}"
    backend_preserve_args+=(--exclude "/$live_backup_relative/")
  fi
  if [[ "$live_upload_dir" == "$live_backend_dir/"* ]]; then
    live_upload_relative="${live_upload_dir#"$live_backend_dir/"}"
    backend_preserve_args+=(--exclude "/$live_upload_relative/")
  fi

  # Capture the current source release before the first live mutation. Runtime
  # data and environment files stay in place and are never part of code rollback.
  if [[ "$initial_install" -eq 0 ]]; then
    [[ -d "$live_web_dir" ]] || die "live web directory is missing: $live_web_dir"
    [[ -d "$live_backend_dir" ]] || die "live backend directory is missing: $live_backend_dir"
    [[ -d "$live_frontend_dir" ]] || die "live frontend directory is missing: $live_frontend_dir"
    mkdir -p "$rollback_root"
    rollback_snapshot="$(mktemp -d "$rollback_root/deploy-XXXXXX")"
    mkdir -p "$rollback_snapshot/web" "$rollback_snapshot/backend" "$rollback_snapshot/frontend"
    rsync -a "${web_preserve_args[@]}" "$live_web_dir/" "$rollback_snapshot/web/"
    rsync -a "${backend_preserve_args[@]}" "$live_backend_dir/" "$rollback_snapshot/backend/"
    rsync -a "$live_frontend_dir/" "$rollback_snapshot/frontend/"
    echo "Code rollback snapshot: $rollback_snapshot"
  fi

  rollback_on_error() {
    local deploy_status=$?
    trap - ERR
    if [[ "$rollback_armed" -eq 1 && -n "${rollback_snapshot:-}" ]]; then
      set +e
      echo "Deployment failed; restoring previous code from $rollback_snapshot" >&2
      rsync -a --checksum --delete "${web_preserve_args[@]}" "$rollback_snapshot/web/" "$live_web_dir/"
      rsync -a --checksum --delete "${backend_preserve_args[@]}" "$rollback_snapshot/backend/" "$live_backend_dir/"
      rsync -a --checksum --delete "$rollback_snapshot/frontend/" "$live_frontend_dir/"
      (
        cd "$live_web_dir" || exit 1
        npm ci && npm run build
      )
      rollback_build_status=$?
      launchctl kickstart -k "gui/$(id -u)/${launchd_label}"
      launchctl kickstart -k "gui/$(id -u)/${backend_launchd_label}"
      if [[ "$rollback_build_status" -eq 0 ]]; then
        echo "Previous code restored. Database backup remains in $live_backup_dir" >&2
      else
        echo "Automatic rebuild after rollback failed; preserved snapshot: $rollback_snapshot" >&2
      fi
    fi
    exit "$deploy_status"
  }
  trap rollback_on_error ERR

  rollback_armed=1
  rsync -a --checksum --delete \
    "${web_preserve_args[@]}" \
    "$repo_dir/apps/web/" "$live_web_dir/"
  rsync -a --checksum --delete \
    "${backend_preserve_args[@]}" \
    "$repo_dir/backend/" "$live_backend_dir/"
  rsync -a --checksum --delete "$repo_dir/frontend/" "$live_frontend_dir/"

  cd "$live_web_dir"
  npm ci
  npm run typecheck
  npm test
  npm run build

  # Both launchd services inherit the same runtime paths and session secret.
  # This prevents Next and Flask from opening different databases after restart.
  launchctl setenv LAB_FEED_DB "$live_db_path"
  launchctl setenv LAB_FEED_SECRET "$LAB_FEED_SECRET"
  launchctl setenv LAB_FEED_COOKIE_SECURE "1"
  launchctl setenv LAB_FEED_DB_READONLY "0"
  launchctl setenv BAI_API_ORIGIN "$api_origin"
  launchctl setenv BAI_UPLOAD_DIR "$live_upload_dir"
  launchctl setenv BAI_MAX_UPLOAD_BYTES "${BAI_MAX_UPLOAD_BYTES:-26214400}"
  launchctl kickstart -k "gui/$(id -u)/${launchd_label}"
  launchctl kickstart -k "gui/$(id -u)/${backend_launchd_label}"
  curl -fsSI https://bai.haiinu.com/login >/dev/null
  curl -fsS "$api_origin/healthz" >/dev/null
  proxy_health_status="$(curl -sS -o /dev/null -w '%{http_code}' "$next_origin/api/healthz")"
  test "$proxy_health_status" = "200"
  proxy_me_status="$(curl -sS -o /dev/null -w '%{http_code}' "$next_origin/api/me")"
  test "$proxy_me_status" = "401"
  runtime_db_fingerprint="$("$python_bin" -c \
    'import hashlib, os, sys; print(hashlib.sha256(os.path.abspath(sys.argv[1]).encode()).hexdigest())' \
    "$live_db_path")"
  runtime_upload_fingerprint="$("$python_bin" -c \
    'import hashlib, os, sys; print(hashlib.sha256(os.path.abspath(sys.argv[1]).encode()).hexdigest())' \
    "$live_upload_dir")"
  curl -fsS --get \
    --data-urlencode "db=$runtime_db_fingerprint" \
    --data-urlencode "uploads=$runtime_upload_fingerprint" \
    "$next_origin/api/runtime-health" >/dev/null
  backend_wall_status="$(curl -sS -o /dev/null -w '%{http_code}' "$api_origin/api/wall")"
  test "$backend_wall_status" = "401"
  rollback_armed=0
  trap - ERR
  echo "Deployed $(git -C "$repo_dir" rev-parse --short HEAD) to https://bai.haiinu.com"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
