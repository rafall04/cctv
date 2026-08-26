#!/usr/bin/env bash
#
# Purpose: Jadikan server ini sumber waktu jaringan kamera, lalu pasang penjaganya. Sekali jalan.
# Caller: deployment/install.sh, atau operator: `sudo bash setup.sh`
# Deps: apt (chrony), systemd, sqlite3, python3. Aman diulang - idempoten.
#
# KENAPA BERKAS INI ADA
# ---------------------
# Jam kamera yang salah membuat rekaman berstempel bohong, dan itu baru ketahuan saat rekaman
# dibutuhkan - yaitu saat sudah terlambat. Memperbaikinya sekali tidak cukup, karena kamera
# kembali ke mode Manual sesudah reset firmware atau mati listrik lalu hanyut diam-diam.
#
# Yang lebih penting untuk pemasangan di tempat pelanggan: TIDAK ADA satu pun alamat yang perlu
# diketik. Subnet kamera diturunkan dari daftar kamera di database, dan alamat NTP yang diberikan
# ke tiap kamera ditentukan dari rute ke kamera itu sendiri. Pemasang tidak perlu tahu apa-apa
# tentang NTP; ia hanya menjalankan ini.
#
# systemd-timesyncd yang biasanya sudah ada TIDAK BISA dipakai: ia klien saja dan tidak pernah
# membuka UDP 123, jadi kamera yang diarahkan kepadanya tidak akan pernah mendapat jawaban.

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/rafnet-cctv}"
DB="${DB:-${APP_DIR}/backend/data/cctv.db}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PENANDA="RAF CCTV - MELAYANI NTP"

info() { echo "  $*"; }
ok()   { echo "  OK  $*"; }
warn() { echo "  !   $*" >&2; }

echo "=== Menyiapkan sumber waktu untuk jaringan kamera ==="

# --- 1. chrony ---------------------------------------------------------------
if ! command -v chronyd >/dev/null 2>&1; then
    info "memasang chrony..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chrony >/dev/null
    ok "chrony terpasang"
else
    ok "chrony sudah ada"
fi

CONF=/etc/chrony/chrony.conf
[ -f /etc/chrony/chrony.conf ] || CONF=/etc/chrony.conf

# --- 2. Subnet kamera: DITURUNKAN, bukan diketik -----------------------------
# Hanya rentang privat. Kamera publik/pihak ketiga bukan urusan kita dan tidak boleh
# membuat server ini melayani NTP ke internet.
SUBNETS=""
if [ -r "$DB" ]; then
    SUBNETS=$(sqlite3 "$DB" \
        "SELECT private_rtsp_url FROM cameras WHERE enabled=1 AND private_rtsp_url LIKE 'rtsp://%@%'" \
        2>/dev/null \
        | sed -E 's#.*@([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+.*#\1.0/24#' \
        | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' \
        | sort -u || true)
fi

if [ -z "$SUBNETS" ]; then
    warn "belum ada kamera ber-IP privat di database."
    warn "chrony tetap dipasang; jalankan ulang skrip ini sesudah kamera ditambahkan."
else
    info "subnet kamera yang terdeteksi:"
    echo "$SUBNETS" | sed 's/^/      /'
fi

# --- 3. Konfigurasi chrony ---------------------------------------------------
# Blok ditulis ulang utuh tiap kali supaya subnet baru ikut masuk saat skrip diulang.
if grep -q "$PENANDA" "$CONF" 2>/dev/null; then
    cp "$CONF" "${CONF}.bak.$(date +%Y%m%d-%H%M%S)"
    sed -i "/# ==== ${PENANDA} MULAI ====/,/# ==== ${PENANDA} SELESAI ====/d" "$CONF"
    info "blok lama dibersihkan (cadangan disimpan)"
fi

{
    echo "# ==== ${PENANDA} MULAI ===="
    echo "# Ditulis otomatis oleh deployment/camera-time/setup.sh - jangan diedit tangan;"
    echo "# jalankan ulang skripnya supaya subnet kamera baru ikut terbawa."
    for net in $SUBNETS; do echo "allow $net"; done
    echo "# Tetap melayani waktu meski hulu internet putus. Untuk CCTV, SATU waktu bersama yang"
    echo "# sedikit meleset jauh lebih berguna daripada tiap kamera berjalan sendiri-sendiri:"
    echo "# rekaman dari kamera berbeda harus bisa disandingkan pada peristiwa yang sama."
    echo "# Stratum 10 membuatnya jelas kalah dari sumber sungguhan begitu internet pulih."
    echo "local stratum 10"
    echo "# ==== ${PENANDA} SELESAI ===="
} >> "$CONF"
ok "chrony dikonfigurasi melayani $(echo "$SUBNETS" | grep -c . || echo 0) subnet"

systemctl disable --now systemd-timesyncd >/dev/null 2>&1 || true
systemctl enable --now chrony >/dev/null 2>&1 || systemctl enable --now chronyd >/dev/null 2>&1
systemctl restart chrony >/dev/null 2>&1 || systemctl restart chronyd >/dev/null 2>&1
ok "chrony berjalan (timesyncd dinonaktifkan - ia tidak bisa melayani)"

# --- 4. Firewall: hanya subnet kamera ----------------------------------------
# NTP server yang terbuka ke internet bisa disalahgunakan untuk serangan amplifikasi.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    for net in $SUBNETS; do
        ufw allow from "$net" to any port 123 proto udp comment 'NTP untuk kamera CCTV' >/dev/null 2>&1 || true
    done
    ok "ufw dibuka untuk UDP 123 dari subnet kamera saja"
fi

# --- 5. Penjaga berkala ------------------------------------------------------
if [ -d /etc/systemd/system ]; then
    sed "s#/var/www/rafnet-cctv#${APP_DIR}#g" "${DIR}/camera-time-check.service" \
        > /etc/systemd/system/camera-time-check.service
    cp "${DIR}/camera-time-check.timer" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable --now camera-time-check.timer >/dev/null 2>&1
    ok "pemeriksa jam kamera aktif (tiap jam, membenahi sendiri)"
fi

# --- 6. Jalankan sekali, jangan menunggu satu jam pertama ---------------------
echo
echo "=== Menyelaraskan kamera sekarang ==="
python3 "${DIR}/check_camera_time.py" --perbaiki || true

echo
echo "Selesai. Mulai sekarang jam kamera dijaga tanpa perlu tindakan siapa pun."
echo "Periksa kapan saja:  python3 ${DIR}/check_camera_time.py"
