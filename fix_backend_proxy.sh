#!/bin/bash
# =================================================================
#
# Title: fix_backend_proxy.sh
#
# Description: This script correctly configures Nginx as a reverse
#              proxy for the Node.js backend, using separate server
#              blocks for the frontend and API for a clean architecture.
#
# Actions:
#   1. Copies the new Nginx configuration.
#   2. Tests Nginx syntax.
#   3. Restarts Nginx.
#   4. Restarts the backend PM2 process.
#   5. Performs curl tests to verify internal and external access.
#
# Usage:
#   Run this script from the project root with sudo.
#   sudo bash fix_backend_proxy.sh
#
# =================================================================

set -e # Exit immediately if a command exits with a non-zero status.

# --- Paths ---
NGINX_SRC_CONFIG="deployment/nginx.conf"
NGINX_DEST_DIR="/etc/nginx/sites-available"
NGINX_DEST_FILE="$NGINX_DEST_DIR/rafnet-cctv"
ECOSYSTEM_CONFIG="deployment/ecosystem.config.cjs"
BACKEND_PM2_NAME="rafnet-cctv-backend" # Assuming this name from ecosystem file

# --- Script Start ---
echo "🚀 Starting Backend Reverse Proxy Fix..."

# 1. Deploy New Nginx Configuration
echo "🌐 Deploying new Nginx configuration with separate server blocks..."
if [ -f "$NGINX_SRC_CONFIG" ]; then
    sudo cp "$NGINX_SRC_CONFIG" "$NGINX_DEST_FILE"
    echo "  - Copied config to $NGINX_DEST_FILE"
    
    # Ensure the site is enabled (and remove default if it exists)
    sudo ln -sf "$NGINX_DEST_FILE" "/etc/nginx/sites-enabled/rafnet-cctv"
    if [ -f "/etc/nginx/sites-enabled/default" ]; then
        sudo rm "/etc/nginx/sites-enabled/default"
        echo "  - Removed default Nginx site link."
    fi
else
    echo "  ❌ ERROR: Source Nginx config '$NGINX_SRC_CONFIG' not found. Aborting."
    exit 1
fi

# 2. Test and Restart Nginx
echo "⚙️ Testing Nginx configuration syntax..."
sudo nginx -t

echo "🔄 Restarting Nginx service..."
sudo systemctl restart nginx
echo "  ✅ Nginx restarted successfully."

# 3. Restart Backend Service
echo "🚀 Restarting backend PM2 process to ensure a fresh state..."
pm2 restart "$BACKEND_PM2_NAME"
sleep 2
pm2 status

# 4. Perform Verification Tests
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
echo "    (Note: This tests if Nginx is proxying correctly. It may fail if DNS is not pointed.)"
if curl -s --head -H "Host: api-cctv.raf.my.id" "http://127.0.0.1/health" | head -n 1 | grep "200 OK" > /dev/null; then
    echo "    ✅ SUCCESS: Nginx is correctly proxying requests for api-cctv.raf.my.id."
else
    echo "    ❌ FAILURE: Nginx is NOT proxying correctly. Check Nginx error logs."
    echo "       Command used: curl -s --head -H \"Host: api-cctv.raf.my.id\" \"http://127.0.0.1/health\""
fi

echo "---"
echo "✅ Script finished. Check the test results above."
