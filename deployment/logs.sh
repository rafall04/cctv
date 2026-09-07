#!/bin/bash
# RAF NET CCTV - Logs: ekor log backend client ini (nama diturunkan dari client.config.sh).
# Pakai:  bash deployment/logs.sh            → log backend
#         bash deployment/logs.sh recorder   → log proses recorder (mode worker)
#         bash deployment/logs.sh mediamtx   → log MediaMTX
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "${SCRIPT_DIR}/client.config.sh" ]; then
    echo "❌ client.config.sh tidak ada — jalankan installer dulu."
    exit 1
fi
source "${SCRIPT_DIR}/client.config.sh"
case "${1:-backend}" in
    recorder) TARGET="${CLIENT_CODE}-cctv-recorder" ;;
    mediamtx) TARGET="${CLIENT_CODE}-mediamtx" ;;
    *)        TARGET="${CLIENT_CODE}-cctv-backend" ;;
esac
echo "📜 Log ${TARGET} (Ctrl-C untuk keluar)"
pm2 logs "$TARGET"
