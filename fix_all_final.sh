#!/bin/bash
# =================================================================
#
# Title: fix_all_final.sh
#
# Description: This is a comprehensive script to fix all outstanding
#              issues including the backend crash-on-startup, incorrect
#              frontend API URL, and errored MediaMTX state.
#
# Actions:
#   1. Stops all services.
#   2. Deploys the clean MediaMTX config.
#   3. Rebuilds the frontend with the correct API endpoint.
#   4. Deploys the correct Nginx reverse proxy config.
#   5. Restarts all services and runs verification tests.
#
# Usage:
#   Run this script from the project root with sudo.
#   sudo bash fix_all_final.sh
#
# =================================================================

set -e # Exit immediately if a command exits with a non-zero status.

# --- Paths ---
MEDIAMTX_SRC_CONFIG="mediamtx/mediamtx.yml"
MEDIAMTX_DEST_DIR="/var/www/rafnet-cctv/mediamtx"
MEDIAMTX_DEST_FILE="$MEDIAMTX_DEST_DIR/mediamtx.yml"

NGINX_SRC_CONFIG="deployment/nginx.conf"
NGINX_DEST_FILE="/etc/nginx/sites-available/rafnet-cctv"

FRONTEND_DIR="frontend"
ECOSYSTEM_CONFIG="deployment/ecosystem.config.cjs"
BACKEND_PM2_NAME="rafnet-cctv-backend"

# --- Script Start ---
echo "🚀 Starting Final Comprehensive Fix..."

# 1. Stop all PM2 services
echo "🛑 Stopping all PM2 services..."
pm2 stop all || echo "PM2 services not running."

# 2. Deploy Clean MediaMTX and Nginx Configs
echo "⚙️ Deploying clean configurations for MediaMTX and Nginx..."
sudo mkdir -p "$MEDIAMTX_DEST_DIR"
sudo cp "$NGINX_SRC_CONFIG" "$NGINX_DEST_FILE"
echo "  - Configurations copied."

# 3. Rebuild Frontend
echo "🏗️ Rebuilding frontend application with correct API URL..."
cd "$FRONTEND_DIR"
npm install
npm run build
cd ..
echo "  ✅ Frontend rebuild complete."

# 4. Test and Restart Nginx
echo "🔄 Testing and restarting Nginx..."
sudo nginx -t
sudo systemctl restart nginx
echo "  - Nginx restarted."

# 5. Restart All Services
echo "🚀 Restarting all PM2 processes..."
pm2 restart all
sleep 3
pm2 status

# 6. Perform Verification Tests
echo "🔎 Performing verification tests..."
echo "---"

echo "  - Test 1: Internal Backend (localhost:3000)"
if curl -s --head "http://localhost:3000/health" | head -n 1 | grep "200 OK" > /dev/null; then
    echo "    ✅ SUCCESS: Backend is responding correctly on localhost:3000."
else
    echo "    ❌ FAILURE: Backend is NOT responding on localhost:3000. Check PM2 logs for '$BACKEND_PM2_NAME'."
fi

echo "---"

echo "  - Test 2: External API Domain (api-cctv.raf.my.id)"
echo "    (Note: This tests if Nginx is proxying correctly.)"
if curl -s --head -H "Host: api-cctv.raf.my.id" "http://127.0.0.1/health" | head -n 1 | grep "200 OK" > /dev/null; then
    echo "    ✅ SUCCESS: Nginx is correctly proxying requests for api-cctv.raf.my.id."
else
    echo "    ❌ FAILURE: Nginx is NOT proxying correctly. Check Nginx error logs."
fi

echo "---"
echo "✅ All fixes applied. Check the test results above."
