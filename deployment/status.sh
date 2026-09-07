#!/bin/bash
# RAF NET CCTV - Status: ringkas proses PM2 untuk client ini (nama diturunkan dari client.config.sh).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "${SCRIPT_DIR}/client.config.sh" ]; then
    echo "❌ client.config.sh tidak ada — jalankan installer dulu."
    exit 1
fi
source "${SCRIPT_DIR}/client.config.sh"
echo "📊 Status — $CLIENT_NAME (${CLIENT_CODE})"
pm2 list | grep "${CLIENT_CODE}" || pm2 list
echo ""
echo "💡 Log     : bash deployment/logs.sh"
echo "💡 Cek sehat: bash deployment/healthcheck.sh"
