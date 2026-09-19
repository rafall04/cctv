#!/usr/bin/env bash
# RAF NET Titik Speaker — installer satu-perintah untuk STB Armbian (HG680P/B860H, dst).
#
# Pemakaian (di STB, sebagai root):
#   curl -sL https://<HUB>/api/admin/audio/node/install | bash -s -- <TOKEN>
# atau non-interaktif penuh:
#   HUB_URL=https://cctv.contoh.desa TOKEN=xxx bash install-speaker.sh
#
# Yang dilakukan: pasang alsa-utils+python3, unduh audio_node.py dari hub, tulis
# /etc/rafnet-speaker.conf, pasang+jalankan systemd unit, lalu verifikasi poll pertama.
set -euo pipefail

TOKEN="${1:-${TOKEN:-}}"
HUB_URL="${HUB_URL:-__HUB_URL__}"   # __HUB_URL__ diganti hub saat script diunduh lewat /node/install

if [ "$(id -u)" -ne 0 ]; then
    echo "Jalankan sebagai root: sudo bash install-speaker.sh <TOKEN>" >&2
    exit 1
fi

if [ -z "$HUB_URL" ] || [ "$HUB_URL" = "__HUB_URL__" ]; then
    # Placeholder utuh = salinan manual (bukan unduhan langsung dari hub). Baca dari /dev/tty:
    # stdin sedang dipakai pipe `curl | bash`, jadi `read` biasa langsung dapat EOF.
    read -rp "URL hub (mis. https://cctv.contoh.desa): " HUB_URL </dev/tty || true
fi
HUB_URL="${HUB_URL%/}"
if [ -z "$HUB_URL" ] || [ "$HUB_URL" = "__HUB_URL__" ] || [ -z "$TOKEN" ]; then
    echo "HUB_URL dan TOKEN wajib. Contoh:" >&2
    echo "  curl -sL https://cctv.contoh.desa/api/admin/audio/node/install | bash -s -- <TOKEN>" >&2
    exit 1
fi

echo "==> Memasang dependensi (python3 + alsa-utils)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 alsa-utils curl >/dev/null

echo "==> Mengunduh agen ke /opt/rafnet/audio_node.py"
install -d -m 0755 /opt/rafnet
curl -fsSL "$HUB_URL/api/admin/audio/node/agent" -o /opt/rafnet/audio_node.py
chmod 0644 /opt/rafnet/audio_node.py
# Sanity: file yang diunduh harus python, bukan halaman error HTML.
head -1 /opt/rafnet/audio_node.py | grep -q "python3" || {
    echo "Unduhan agen gagal (bukan script python) — cek HUB_URL" >&2; exit 1; }

echo "==> Menulis /etc/rafnet-speaker.conf"
install -m 0600 /dev/null /etc/rafnet-speaker.conf   # token jangan bisa dibaca semua user
cat > /etc/rafnet-speaker.conf <<EOF
HUB_URL=$HUB_URL
TOKEN=$TOKEN
PLAYER=aplay
EOF

echo "==> Memasang systemd unit"
cat > /etc/systemd/system/rafnet-speaker.service <<EOF
[Unit]
Description=RAF NET Titik Speaker
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 /opt/rafnet/audio_node.py
EnvironmentFile=/etc/rafnet-speaker.conf
Restart=always
RestartSec=3
# Audio buffer kecil supaya long-poll talk terasa hidup; default ALSA cukup untuk klip.

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now rafnet-speaker.service

echo "==> Verifikasi: poll pertama ke hub (long-poll, ditahan hub s.d. ~25s)"
sleep 2
# Poll yang valid MENUNGGU sampai window 25s habis — jangan pakai timeout pendek (token benar
# pun akan tampak "gagal"). Ambil HTTP code: 200 = token OK; 401/403 = token ditolak.
code="$(curl -sS -m 35 -o /dev/null -w '%{http_code}' -H "x-device-token: $TOKEN" "$HUB_URL/api/admin/audio/node/poll" || true)"
case "$code" in
    200)    echo "    OK — token diterima, node terdaftar online di hub." ;;
    401|403) echo "    GAGAL: token ditolak hub (HTTP $code) — regen token di admin lalu ulangi." >&2; exit 1 ;;
    *)      echo "    PERINGATAN: poll gagal (HTTP $code) — cek HUB_URL/jaringan. Log: journalctl -u rafnet-speaker -f" >&2 ;;
esac

echo
echo "Selesai. Status: systemctl status rafnet-speaker"
echo "Tes suara : dari admin → Audio → Titik Speaker → Uji pada titik ini."
