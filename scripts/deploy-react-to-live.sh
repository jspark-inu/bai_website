#!/usr/bin/env bash
set -euo pipefail

# Protect runtime state even when the Next release is synchronized with
# --delete. SQLite sidecars, uploads, environment files, and build caches are
# never release artifacts.
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

die() {
  echo "ERROR: $*" >&2
  exit 1
}

wait_http_status() {
  local url="$1"
  local expected_status="$2"
  local actual_status response_body response_file
  local attempt attempts delay_seconds
  attempts="${BAI_HEALTH_ATTEMPTS:-30}"
  delay_seconds="${BAI_HEALTH_DELAY_SECONDS:-2}"
  [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || die "BAI_HEALTH_ATTEMPTS must be a positive integer"
  [[ "$delay_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "BAI_HEALTH_DELAY_SECONDS must be non-negative"
  response_file="$(mktemp)"
  for attempt in $(seq 1 "$attempts"); do
    if actual_status="$(curl -sS -o "$response_file" -w '%{http_code}' "$url")"; then
      if [[ "$actual_status" == "$expected_status" ]]; then
        rm -f "$response_file"
        return 0
      fi
    else
      actual_status="curl-failed"
    fi
    sleep "$delay_seconds"
  done
  response_body="$(<"$response_file")"
  rm -f "$response_file"
  echo "ERROR: HTTP readiness check failed for $url: expected $expected_status, got ${actual_status:-no-response}; body=${response_body:0:500}" >&2
  return 1
}

path_fingerprint() {
  node -e 'const crypto=require("node:crypto"),path=require("node:path");process.stdout.write(crypto.createHash("sha256").update(path.resolve(process.argv[1])).digest("hex"))' "$1"
}

main() {
  local repo_dir live_web_dir launchd_label live_db_path live_backup_dir live_upload_dir
  local rollback_root rollback_snapshot rollback_build_status runtime_env_file
  local next_origin required_name runtime_health_url initial_install_override
  local web_db_relative web_backup_relative web_upload_relative
  local runtime_db_fingerprint runtime_upload_fingerprint db_parent
  local rollback_armed=0
  local initial_install=0
  local -a web_preserve_args

  runtime_env_file="${BAI_RUNTIME_ENV_FILE:-/Users/hai_1/AI-Workspace/code/runtime/config/bai-website.env}"
  if [[ -e "$runtime_env_file" || -L "$runtime_env_file" ]]; then
    [[ -f "$runtime_env_file" && -r "$runtime_env_file" && ! -L "$runtime_env_file" ]] || \
      die "BAI runtime env must be a readable regular file, not a symlink: $runtime_env_file"
    if [[ -z "${LAB_FEED_DB:-}" || -z "${BAI_UPLOAD_DIR:-}" || -z "${BAI_LIVE_BACKUP_DIR:-}" || \
      -z "${BAI_ROLLBACK_DIR:-}" || -z "${LAB_FEED_SECRET:-}" ]]; then
      set -a
      # shellcheck disable=SC1090
      source "$runtime_env_file"
      set +a
    fi
  fi
  for required_name in LAB_FEED_DB BAI_UPLOAD_DIR BAI_LIVE_BACKUP_DIR BAI_ROLLBACK_DIR LAB_FEED_SECRET; do
    [[ -n "${!required_name:-}" ]] || die \
      "$required_name must be explicit in BAI_RUNTIME_ENV_FILE or the deploy environment"
  done
  if [[ "${#LAB_FEED_SECRET}" -lt 32 ]]; then
    die "LAB_FEED_SECRET must contain at least 32 characters"
  fi
  case "$LAB_FEED_SECRET" in
    dev|dev-insecure-secret|change-me-*)
      die "LAB_FEED_SECRET is still a public development placeholder" ;;
  esac
  case "${LAB_FEED_COOKIE_SECURE:-}" in
    1|true|TRUE|yes|YES|on|ON) ;;
    *) die "LAB_FEED_COOKIE_SECURE=1 is required for live deployment" ;;
  esac

  repo_dir="${BAI_WEBSITE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  live_web_dir="${BAI_LIVE_WEB_DIR:-/Users/hai_1/AI-Workspace/code/projects/dev/1C38-lab-feed/apps/web}"
  launchd_label="${BAI_NEXT_LAUNCHD_LABEL:-com.user.bai-next}"
  live_db_path="$LAB_FEED_DB"
  live_backup_dir="$BAI_LIVE_BACKUP_DIR"
  live_upload_dir="$BAI_UPLOAD_DIR"
  rollback_root="$BAI_ROLLBACK_DIR"
  next_origin="${BAI_NEXT_ORIGIN:-http://127.0.0.1:5067}"
  initial_install_override="${BAI_ALLOW_MISSING_LIVE_DB_FOR_INITIAL_INSTALL:-}"

  case "$next_origin" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) die "BAI_NEXT_ORIGIN must use the local Next service: $next_origin" ;;
  esac
  for required_name in live_db_path live_web_dir live_backup_dir live_upload_dir rollback_root; do
    case "${!required_name}" in
      /*) ;;
      *) die "$required_name must be an absolute path: ${!required_name}" ;;
    esac
  done
  case "$live_web_dir" in
    /|"$repo_dir"|"$repo_dir/"*)
      die "BAI_LIVE_WEB_DIR must not be a broad or source-overlapping path: $live_web_dir" ;;
  esac
  if [[ -L "$live_web_dir" ]]; then
    die "live web directory cannot be a symlink: $live_web_dir"
  fi
  if [[ "$live_upload_dir" == "$live_web_dir" || "$live_backup_dir" == "$live_web_dir" ]]; then
    die "runtime upload/backup directories cannot equal BAI_LIVE_WEB_DIR"
  fi

  # Fail closed before dependency installation, build, backup, or live sync.
  if [[ -f "$live_db_path" ]]; then
    :
  elif [[ "$initial_install_override" == "I_UNDERSTAND_THIS_CREATES_A_NEW_EMPTY_BAI_DATABASE" ]]; then
    if [[ -e "$live_db_path" || -L "$live_db_path" ]]; then
      die "initial-install override refused because the DB path exists but is not a regular file: $live_db_path"
    fi
    db_parent="$(dirname "$live_db_path")"
    if [[ -d "$db_parent" ]] && find "$db_parent" -maxdepth 1 -type f \
      \( -name '*.db*' -o -name '*.sqlite*' -o -name '*.sqlite3*' \) -print -quit | grep -q .; then
      die "initial-install override refused because another SQLite database exists beside $live_db_path"
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

  # The Node backup command performs source quick_check, foreign-key/schema
  # validation, SQLite online backup, destination integrity_check, fsync, and
  # atomic publication before any live code changes.
  if [[ "$initial_install" -eq 0 ]]; then
    npm run backup -- --db "$live_db_path" --backup-dir "$live_backup_dir"
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

  # Only the Next release is snapshotted and synchronized. Legacy sources and
  # runtime data remain untouched for the separately approved cutover/rollback.
  if [[ "$initial_install" -eq 0 ]]; then
    [[ -d "$live_web_dir" ]] || die "live web directory is missing: $live_web_dir"
    mkdir -p "$rollback_root"
    rollback_snapshot="$(mktemp -d "$rollback_root/deploy-XXXXXX")"
    mkdir -p "$rollback_snapshot/web"
    rsync -a "${web_preserve_args[@]}" "$live_web_dir/" "$rollback_snapshot/web/"
    echo "Code rollback snapshot: $rollback_snapshot"
  fi

  rollback_on_error() {
    local deploy_status=$?
    trap - ERR
    if [[ "$rollback_armed" -eq 1 && -n "${rollback_snapshot:-}" ]]; then
      set +e
      echo "Deployment failed; restoring previous code from $rollback_snapshot" >&2
      rsync -a --checksum --delete "${web_preserve_args[@]}" "$rollback_snapshot/web/" "$live_web_dir/"
      (
        cd "$live_web_dir" || exit 1
        npm ci && npm run build
      )
      rollback_build_status=$?
      launchctl kickstart -k "gui/$(id -u)/${launchd_label}"
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

  # `.next` is generated state, not runtime data. Preserving it across a
  # release can leave route validators for source files removed by the new
  # release, causing `next typegen && tsc` to fail before the fresh build.
  rm -rf -- "$live_web_dir/.next"

  cd "$live_web_dir"
  npm ci
  npm run typecheck
  npm test
  npm run build

  mkdir -p "$live_upload_dir"
  LAB_FEED_DB="$live_db_path" LAB_FEED_DB_READONLY=0 npm run migrate

  launchctl setenv LAB_FEED_DB "$live_db_path"
  launchctl setenv LAB_FEED_SECRET "$LAB_FEED_SECRET"
  launchctl setenv LAB_FEED_COOKIE_SECURE "1"
  launchctl setenv LAB_FEED_DB_READONLY "0"
  launchctl setenv BAI_UPLOAD_DIR "$live_upload_dir"
  launchctl setenv BAI_MAX_UPLOAD_BYTES "${BAI_MAX_UPLOAD_BYTES:-26214400}"
  launchctl kickstart -k "gui/$(id -u)/${launchd_label}"
  wait_http_status "$next_origin/login" "200"
  wait_http_status "$next_origin/api/healthz" "200"
  wait_http_status "$next_origin/api/me" "401"
  runtime_db_fingerprint="$(path_fingerprint "$live_db_path")"
  runtime_upload_fingerprint="$(path_fingerprint "$live_upload_dir")"
  runtime_health_url="$next_origin/api/runtime-health"
  wait_http_status \
    "$runtime_health_url?db=$runtime_db_fingerprint&uploads=$runtime_upload_fingerprint" \
    "200"
  rollback_armed=0
  trap - ERR
  echo "Deployed $(git -C "$repo_dir" rev-parse --short HEAD) to https://bai.haiinu.com"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
