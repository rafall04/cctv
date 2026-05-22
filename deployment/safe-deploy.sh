#!/usr/bin/env bash
# Purpose: Safe, repeatable production deploy for RAF NET CCTV.
#          Repairs incomplete .env files (keeps strong existing secrets and any
#          existing flag values, fills only missing keys), backs up the DB, then
#          fast-forwards + installs + migrates + builds + restarts.
# Caller:  Operator on the production server: bash deployment/safe-deploy.sh [check|deploy]
# Deps:    bash, git, node, npm, pm2, curl.
# MainFuncs: preflight, prepare backend/frontend .env, backup, pull+install+migrate+build,
#            pm2 restart, health verify, print rollback steps.
# Note:    Security flags (RATE_LIMIT/CSRF/API_KEY) are PRESERVED if already set —
#          the script never overwrites an operator's chosen value.
# SideEffects: Edits backend/.env and frontend/.env (gitignored), backs up the SQLite DB,
#              fast-forwards the repo to origin/main, restarts PM2 processes.

set -euo pipefail

# ---------------------------------------------------------------------------
# Locate directories
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
BACKEND_ENV="$BACKEND_DIR/.env"
FRONTEND_ENV="$FRONTEND_DIR/.env"

MODE="${1:-deploy}"   # "check" = repair .env + report only; "deploy" = full deploy

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;36m'; NC=$'\033[0m'
info()  { echo -e "${BLUE}ℹ${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1" >&2; }
hr()    { echo "------------------------------------------------------------"; }
fatal() { err "$1"; exit 1; }

# ---------------------------------------------------------------------------
# Secret helpers
# ---------------------------------------------------------------------------
gen_secret() { node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }

# Returns 0 (true) if the value looks like a placeholder/weak secret.
is_weak_secret() {
    local val="$1"
    local lower
    lower="$(printf '%s' "$val" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
        *change_this*|*change-this*|*changeme*|*your-secret*|*your_secret*) return 0 ;;
        *raf_net_secure_cctv_2025_prod*|*secret-here*|*replace-me*|*example*|*default-secret*) return 0 ;;
    esac
    [ "${#val}" -lt 32 ] && return 0
    return 1
}

# ---------------------------------------------------------------------------
# .env helpers (operate on a key=value file)
# ---------------------------------------------------------------------------
env_get() {
    # env_get <file> <key>  -> prints value (empty if absent)
    grep -E "^${2}=" "$1" 2>/dev/null | head -1 | cut -d= -f2- || true
}

env_has() { grep -qE "^${2}=" "$1" 2>/dev/null; }

env_ensure() {
    # env_ensure <file> <key> <default>  -> add only if the key is missing
    local file="$1" key="$2" val="$3"
    if ! env_has "$file" "$key"; then
        echo "${key}=${val}" >> "$file"
        echo "    + added   ${key}"
    else
        echo "    · kept    ${key}"
    fi
}

env_set() {
    # env_set <file> <key> <value>  -> overwrite (or add) the key
    local file="$1" key="$2" val="$3"
    if env_has "$file" "$key"; then
        grep -vE "^${key}=" "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
    fi
    echo "${key}=${val}" >> "$file"
}

ensure_secret() {
    # ensure_secret <file> <key> <random-bytes>
    local file="$1" key="$2" bytes="$3" cur
    cur="$(env_get "$file" "$key")"
    if [ -z "$cur" ]; then
        env_set "$file" "$key" "$(gen_secret "$bytes")"
        echo "    + generated ${key} (was missing)"
    elif is_weak_secret "$cur"; then
        warn "${key} is WEAK or a placeholder."
        local ans=""
        read -r -p "      Regenerate ${key}? Existing logins will be invalidated once. [y/N]: " ans || true
        if [ "${ans}" = "y" ] || [ "${ans}" = "Y" ]; then
            env_set "$file" "$key" "$(gen_secret "$bytes")"
            echo "    + regenerated ${key}"
        else
            echo "    ! kept weak ${key} — the server will REFUSE to boot in production"
        fi
    else
        echo "    · kept    ${key} (already strong)"
    fi
}

# ===========================================================================
# PHASE 1 — Preflight
# ===========================================================================
hr
echo " RAF NET CCTV — Safe Deploy   (mode: ${MODE})"
hr
[ "$MODE" = "check" ] || [ "$MODE" = "deploy" ] || fatal "Unknown mode '${MODE}'. Use: check | deploy"

for bin in git node npm curl; do
    command -v "$bin" >/dev/null 2>&1 || fatal "Required command not found: ${bin}"
done
[ -d "$BACKEND_DIR" ] || fatal "Backend directory not found: ${BACKEND_DIR}"
[ -f "$BACKEND_DIR/server.js" ] || fatal "Not a CCTV checkout (backend/server.js missing)."
ok "Preflight: tooling and project layout OK"

# Resolve the PM2 process names (optional — only needed for the deploy mode).
CLIENT_CODE=""
if [ -f "$SCRIPT_DIR/client.config.sh" ]; then
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/client.config.sh"
fi
BACKEND_PM2="${CLIENT_CODE:+${CLIENT_CODE}-}cctv-backend"
MEDIAMTX_PM2="${CLIENT_CODE:+${CLIENT_CODE}-}mediamtx"

# ===========================================================================
# PHASE 2 — Repair backend/.env
# ===========================================================================
hr
info "Preparing backend/.env"
if [ ! -f "$BACKEND_ENV" ]; then
    touch "$BACKEND_ENV"
    warn "backend/.env did not exist — created a fresh one."
fi
cp "$BACKEND_ENV" "${BACKEND_ENV}.bak.$(date +%Y%m%d-%H%M%S)"

# Core runtime
env_ensure "$BACKEND_ENV" "NODE_ENV" "production"
env_ensure "$BACKEND_ENV" "PORT"     "3000"
env_ensure "$BACKEND_ENV" "HOST"     "0.0.0.0"

# Secrets — keep strong existing values, generate/replace weak ones
ensure_secret "$BACKEND_ENV" "JWT_SECRET"     48
ensure_secret "$BACKEND_ENV" "CSRF_SECRET"    16
ensure_secret "$BACKEND_ENV" "API_KEY_SECRET" 32

# Origin + proxy — required for correct CORS / origin validation / rate-limit IP
env_ensure "$BACKEND_ENV" "ALLOWED_ORIGINS"     ""
env_ensure "$BACKEND_ENV" "TRUSTED_PROXY_CIDRS" "127.0.0.1/32,::1/128"

# Security flags — only add when missing; an operator's existing value is kept.
# The one-time staged rollout is done; these now default ON (matches config.js).
env_ensure "$BACKEND_ENV" "RATE_LIMIT_ENABLED"          "true"
env_ensure "$BACKEND_ENV" "CSRF_ENABLED"                "true"
env_ensure "$BACKEND_ENV" "API_KEY_VALIDATION_ENABLED"  "true"
# Proactive recording-health Telegram alerts (no-op unless Telegram is configured).
env_ensure "$BACKEND_ENV" "RECORDING_HEALTH_ALERTS_ENABLED" "true"

if [ -z "$(env_get "$BACKEND_ENV" "ALLOWED_ORIGINS")" ]; then
    warn "ALLOWED_ORIGINS is empty. Set it to your production origin(s), e.g.:"
    echo "      ALLOWED_ORIGINS=https://cctv.your-domain.com"
    echo "      (or set FRONTEND_DOMAIN + SERVER_IP so it can auto-generate)"
fi
ok "backend/.env prepared"

# ===========================================================================
# PHASE 3 — Repair frontend/.env
# ===========================================================================
hr
info "Preparing frontend/.env"
if [ -d "$FRONTEND_DIR" ]; then
    if [ ! -f "$FRONTEND_ENV" ]; then
        touch "$FRONTEND_ENV"
        warn "frontend/.env did not exist — created a fresh one."
    fi
    cp "$FRONTEND_ENV" "${FRONTEND_ENV}.bak.$(date +%Y%m%d-%H%M%S)"

    env_ensure "$FRONTEND_ENV" "VITE_API_URL"        "https://api-cctv.your-domain.com"
    env_ensure "$FRONTEND_ENV" "VITE_FRONTEND_DOMAIN" "cctv.your-domain.com"
    env_ensure "$FRONTEND_ENV" "VITE_API_KEY"        "CHANGE_THIS_BEFORE_ENABLING_API_KEY"

    case "$(env_get "$FRONTEND_ENV" "VITE_API_URL")" in
        *your-domain*) warn "VITE_API_URL still has a placeholder domain — set the real backend URL." ;;
    esac
    case "$(env_get "$FRONTEND_ENV" "VITE_API_KEY")" in
        CHANGE_THIS*) warn "VITE_API_KEY is a placeholder. Set a real key BEFORE enabling API key validation (step 4b)." ;;
    esac
    ok "frontend/.env prepared"
else
    warn "frontend/ not found — skipping frontend .env (separate frontend deploy?)"
fi

# ---------------------------------------------------------------------------
# CHECK MODE — stop here, no deploy
# ---------------------------------------------------------------------------
if [ "$MODE" = "check" ]; then
    hr
    ok "CHECK complete. .env files repaired; nothing was deployed."
    echo "Review the files above, then run:  bash deployment/safe-deploy.sh deploy"
    exit 0
fi

# ===========================================================================
# PHASE 4 — Confirm
# ===========================================================================
hr
echo "About to deploy to PRODUCTION:"
echo "  • git fast-forward to origin/main"
echo "  • npm install (backend + frontend)"
echo "  • run database migrations"
echo "  • build frontend"
echo "  • pm2 restart ${BACKEND_PM2}"
echo "  • existing security-flag values in backend/.env are preserved as-is."
echo ""
CONFIRM=""
read -r -p "Proceed? [y/N]: " CONFIRM || true
[ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ] || { warn "Aborted by operator."; exit 0; }

# ===========================================================================
# PHASE 5 — Backup
# ===========================================================================
hr
info "Backing up"
ROLLBACK_COMMIT="$(git -C "$APP_DIR" rev-parse HEAD)"
echo "$ROLLBACK_COMMIT" > "$SCRIPT_DIR/.last-deploy-rollback"
ok "Current commit recorded for rollback: ${ROLLBACK_COMMIT}"

DB_PATH="$BACKEND_DIR/data/cctv.db"
if [ -f "$DB_PATH" ]; then
    DB_BAK="${DB_PATH}.backup-$(date +%Y%m%d-%H%M%S)"
    cp "$DB_PATH" "$DB_BAK"
    ok "Database backed up: ${DB_BAK}"
else
    warn "Database not found at ${DB_PATH} (first run?) — skipping DB backup."
fi

# ===========================================================================
# PHASE 6 — Pull + install + migrate + build
# ===========================================================================
hr
info "Updating code"
if [ -n "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]; then
    fatal "Working tree has uncommitted tracked changes. Resolve them, then re-run."
fi
git -C "$APP_DIR" fetch origin main
git -C "$APP_DIR" checkout main
git -C "$APP_DIR" merge --ff-only origin/main
ok "Code fast-forwarded to origin/main"

info "Installing backend dependencies"
( cd "$BACKEND_DIR" && npm install --omit=dev --no-audit --no-fund )
ok "Backend dependencies installed"

info "Running database migrations"
( cd "$BACKEND_DIR" && npm run migrate )
ok "Migrations applied"

if [ -d "$FRONTEND_DIR" ]; then
    info "Installing frontend dependencies + building"
    ( cd "$FRONTEND_DIR" && npm install --no-audit --no-fund && npm run build )
    ok "Frontend built"
fi

# ===========================================================================
# PHASE 7 — Restart + health verify
# ===========================================================================
hr
info "Restarting services"
if command -v pm2 >/dev/null 2>&1; then
    pm2 restart "$BACKEND_PM2" --update-env || fatal "pm2 restart ${BACKEND_PM2} failed."
    pm2 restart "$MEDIAMTX_PM2" --update-env >/dev/null 2>&1 || true
    ok "PM2 restarted ${BACKEND_PM2}"
else
    warn "pm2 not found — restart the backend manually."
fi

PORT="$(env_get "$BACKEND_ENV" "PORT")"; PORT="${PORT:-3000}"
info "Waiting for /health on port ${PORT}"
HEALTH_OK=0
for _ in $(seq 1 20); do
    if curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; then
        HEALTH_OK=1; break
    fi
    sleep 2
done

hr
if [ "$HEALTH_OK" = "1" ]; then
    ok "Health check passed — backend is up."
else
    err "Health check FAILED after ~40s."
    echo "  Inspect:  pm2 logs ${BACKEND_PM2} --lines 50"
    echo "  Common cause: a weak/placeholder secret — the boot guard refused to start."
    echo "  Rollback:  git -C ${APP_DIR} reset --hard ${ROLLBACK_COMMIT} && bash deployment/safe-deploy.sh deploy"
    exit 1
fi

# ===========================================================================
# PHASE 8 — Next steps
# ===========================================================================
hr
ok "DEPLOY COMPLETE."
echo ""
echo "Verify in a browser:"
echo "  • Public landing page loads with cameras."
echo "  • Admin login works; Dashboard + Recording Dashboard load."
echo "  • Admin → Security Activity shows recent events."
echo "  • Create/edit a camera, then change a setting (exercises CSRF)."
echo ""
echo "Watch the logs for a few minutes:"
echo "  pm2 logs ${BACKEND_PM2} --lines 50"
echo ""
echo "Rollback (if anything breaks):"
echo "  git -C ${APP_DIR} reset --hard ${ROLLBACK_COMMIT}"
echo "  bash deployment/safe-deploy.sh deploy"
hr
