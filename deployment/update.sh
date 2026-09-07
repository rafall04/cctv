#!/bin/bash
# RAF NET CCTV - Update Script (buyer-safe)
#
# Deterministic, conflict-free update: fetches the seller's latest code and resets to it, installs
# from the committed lockfiles (npm ci — never rewrites them), backs up the DB before migrating,
# migrates with the backend stopped (no lock), rebuilds, restarts (recorder included), and prints
# an exact rollback path. ALL buyer data (DB, recordings, uploads, .env, client.config) is gitignored
# and untracked, so `git reset --hard` never touches it — see .gitignore.

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "${SCRIPT_DIR}/client.config.sh" ]; then
    echo "❌ Error: client.config.sh not found!"
    echo "Jalankan installer dulu:  bash deployment/install.sh  (atau aapanel-install.sh)"
    exit 1
fi
source "${SCRIPT_DIR}/client.config.sh"

echo "🔄 RAF NET CCTV - Update"
echo "========================"
echo "Client: $CLIENT_NAME"
echo ""

cd "$APP_DIR"

BACKEND_PM2="${CLIENT_CODE}-cctv-backend"
RECORDER_PM2="${CLIENT_CODE}-cctv-recorder"
MEDIAMTX_PM2="${CLIENT_CODE}-mediamtx"

PREV_COMMIT="$(git rev-parse HEAD)"
DB_BAK=""

# On ANY failure, tell the operator exactly how to get back to the working state — code AND DB.
rollback_hint() {
    echo ""
    print_error "UPDATE GAGAL — sistem mungkin setengah-terupdate."
    echo "   Untuk KEMBALI ke versi sebelum update:"
    echo "     cd \"$APP_DIR\" && git reset --hard ${PREV_COMMIT}"
    if [ -n "$DB_BAK" ]; then
        echo "     # kembalikan DB (schema mungkin sudah maju):"
        echo "     cp \"backend/${DB_BAK}\" backend/data/cctv.db"
    fi
    echo "     cd backend && npm ci --omit=dev && cd ../frontend && npm ci && npm run build"
    echo "     pm2 restart ${BACKEND_PM2}"
    echo ""
}
trap rollback_hint ERR

# --- 1. Fetch + hard reset (conflict-free; buyer data is gitignored so it is never touched) ------
print_info "Mengambil kode terbaru (fetch + reset)..."
git fetch origin main
git reset --hard origin/main
print_success "Kode diperbarui ke: $(git rev-parse --short HEAD)"

# --- 2. Stop services BEFORE migrating (no DB lock; recorder detaches ffmpeg, segmen aman) --------
HAS_RECORDER=no
if pm2 describe "$RECORDER_PM2" >/dev/null 2>&1; then HAS_RECORDER=yes; fi
print_info "Menghentikan layanan sebelum migrasi..."
pm2 stop "$BACKEND_PM2" >/dev/null 2>&1 || true
[ "$HAS_RECORDER" = yes ] && pm2 stop "$RECORDER_PM2" >/dev/null 2>&1 || true

# --- 3. Backend deps from lockfile (npm ci NEVER rewrites package-lock.json) ----------------------
print_info "Memasang dependensi backend (npm ci)..."
cd backend
npm ci --omit=dev

# --- 4. Back up DB (WAL-safe) BEFORE migrating (AGENTS.md invariant) ------------------------------
if [ -f data/cctv.db ]; then
    DB_BAK="data/cctv.db.backup-$(date +%Y%m%d-%H%M%S)"
    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 data/cctv.db ".backup '${DB_BAK}'"
        print_success "DB dicadangkan (konsisten): ${DB_BAK}"
    else
        cp data/cctv.db "$DB_BAK"
        { [ -f data/cctv.db-wal ] && cp data/cctv.db-wal "${DB_BAK}-wal"; } || true
        { [ -f data/cctv.db-shm ] && cp data/cctv.db-shm "${DB_BAK}-shm"; } || true
        print_success "DB dicadangkan (cp fallback: .db + -wal + -shm)"
    fi
    # Keep the 10 most recent pre-update backups; drop older ones so they never fill the DB disk.
    ls -1t data/cctv.db.backup-* 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

# --- 5. Migrate (forward-only; set -e aborts on failure instead of restarting a half-applied DB) --
print_info "Menjalankan migrasi..."
npm run migrate

# --- 6. Rebuild frontend from lockfile -----------------------------------------------------------
print_info "Membangun frontend..."
cd ../frontend
npm ci
npm run build

# --- 7. Restart everything (backend + recorder if present + mediamtx) -----------------------------
print_info "Menjalankan ulang layanan..."
pm2 restart "$BACKEND_PM2" --update-env
[ "$HAS_RECORDER" = yes ] && pm2 restart "$RECORDER_PM2" --update-env && \
    echo "   (recorder di-adopsi lintas restart — segmen tidak terputus)"
pm2 restart "$MEDIAMTX_PM2" >/dev/null 2>&1 || true

# --- 8. Reload web server ------------------------------------------------------------------------
if command -v nginx >/dev/null 2>&1; then
    nginx -t && systemctl reload nginx
elif command -v apache2 >/dev/null 2>&1; then
    apache2ctl -t && systemctl reload apache2
fi

trap - ERR
echo ""
print_success "Update selesai!"
echo "   Versi sekarang : $(git rev-parse --short HEAD)"
echo "   Jika ada masalah, kembali ke versi lama:"
echo "     cd \"$APP_DIR\" && git reset --hard ${PREV_COMMIT} && cd backend && npm ci --omit=dev && cd ../frontend && npm ci && npm run build && pm2 restart ${BACKEND_PM2}"
echo ""
pm2 list | grep "${CLIENT_CODE}" || pm2 list
