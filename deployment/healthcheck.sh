#!/bin/bash
# RAF NET CCTV - Healthcheck
# Satu perintah "apakah semua sehat?" untuk operator awam. Menurunkan nama proses dari
# client.config.sh (jadi benar untuk client mana pun), lalu cek prasyarat + layanan + disk.

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
bad()  { echo -e "${RED}✗ $1${NC}"; FAIL=1; }
FAIL=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "${SCRIPT_DIR}/client.config.sh" ]; then
    echo "❌ client.config.sh tidak ada — jalankan installer dulu (bash deployment/install.sh)."
    exit 1
fi
source "${SCRIPT_DIR}/client.config.sh"
cd "$APP_DIR"

echo "🩺 Healthcheck — $CLIENT_NAME"
echo "================================"

# Port backend dari backend/.env (default 3000)
PORT="$(grep -E '^PORT=' backend/.env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-3000}"

# 1) Prasyarat
command -v node >/dev/null 2>&1 && ok "node: $(node -v)" || bad "node TIDAK terpasang"
command -v ffmpeg >/dev/null 2>&1 && ok "ffmpeg terpasang" || bad "ffmpeg TIDAK terpasang (rekaman/thumbnail gagal)"
command -v pm2 >/dev/null 2>&1 && ok "pm2 terpasang" || bad "pm2 TIDAK terpasang"

# 2) Proses PM2 (nama diturunkan dari CLIENT_CODE)
for P in "${CLIENT_CODE}-cctv-backend" "${CLIENT_CODE}-mediamtx"; do
    if pm2 describe "$P" >/dev/null 2>&1; then
        ST="$(pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const p=JSON.parse(d).find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.status:"?")}catch{console.log("?")}})' "$P" 2>/dev/null)"
        [ "$ST" = "online" ] && ok "pm2 $P: online" || bad "pm2 $P: $ST"
    else
        [ "$P" = "${CLIENT_CODE}-mediamtx" ] && warn "pm2 $P: tidak terdaftar" || bad "pm2 $P: tidak terdaftar"
    fi
done
if pm2 describe "${CLIENT_CODE}-cctv-recorder" >/dev/null 2>&1; then
    ok "pm2 ${CLIENT_CODE}-cctv-recorder: terdaftar (mode worker)"
fi

# 3) Endpoint /health backend
if command -v curl >/dev/null 2>&1; then
    CODE="$(curl -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/health" 2>/dev/null)"
    [ "$CODE" = "200" ] && ok "GET /health (port $PORT): 200" || bad "GET /health (port $PORT): ${CODE:-tak merespons}"
else
    warn "curl tidak ada — lewati cek /health"
fi

# 4) Disk untuk recordings
REC_DIR="$(grep -E '^RECORDINGS_DIR=' backend/.env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
REC_DIR="${REC_DIR:-$APP_DIR/recordings}"
if [ -d "$REC_DIR" ]; then
    USE="$(df -h "$REC_DIR" 2>/dev/null | awk 'NR==2{print $5" terpakai, "$4" bebas"}')"
    PCT="$(df "$REC_DIR" 2>/dev/null | awk 'NR==2{gsub("%","",$5);print $5}')"
    if [ -n "$PCT" ] && [ "$PCT" -ge 92 ]; then bad "Disk recordings ($REC_DIR): $USE"; else ok "Disk recordings: $USE"; fi
else
    warn "Direktori recordings belum ada: $REC_DIR"
fi

echo "--------------------------------"
[ "$FAIL" = "0" ] && ok "Semua sehat." || bad "Ada masalah — lihat baris ✗ di atas."
exit "$FAIL"
