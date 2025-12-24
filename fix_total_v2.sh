#!/bin/bash
# =================================================================
#
# Title: fix_total_v2.sh
#
# Description: This script provides a comprehensive solution to
#              fix critical configuration issues in both MediaMTX
#              and Nginx for the RAF NET CCTV Hub. It sanitizes
#              the MediaMTX config by removing deprecated fields,
#              sets up a universal Nginx server block to accept
#              all traffic, and restarts services in the correct
#              order.
#
# Actions:
#   1. Stops all PM2 managed processes.
#   2. Sanitizes the MediaMTX configuration file.
#   3. Rebuilds the frontend application to ensure the latest
#      version is deployed.
#   4. Overwrites the default Nginx configuration and restarts
#      the Nginx service.
#   5. Flushes PM2 logs to start fresh.
#   6. Starts all applications using the PM2 ecosystem file.
#   7. Displays the latest MediaMTX logs to confirm a
#      successful start.
#
# Usage:
#   Run this script from the project root directory.
#   Ensure you have sudo privileges for service management.
#
#   bash deployment/fix_total_v2.sh
#
# =================================================================

# --- Paths ---
MEDIAMTX_CONFIG="/var/www/rafnet-cctv/mediamtx/mediamtx.yml"
NGINX_CONFIG_SRC="deployment/nginx.conf"
NGINX_CONFIG_DEST="/etc/nginx/sites-available/default"
FRONTEND_DIR="frontend"
ECOSYSTEM_CONFIG="deployment/ecosystem.config.cjs"

# --- Script Start ---
echo "🚀 Starting Total System Fix v2 for RAF NET CCTV Hub..."

# 1. Stop all PM2 services
echo "🛑 Stopping all PM2 services..."
pm2 stop all

# 2. Sanitize MediaMTX Configuration
echo "🔧 Sanitizing MediaMTX config at $MEDIAMTX_CONFIG..."
if [ -f "$MEDIAMTX_CONFIG" ]; then
    # Use sudo for sed -i if permissions require it. Assuming the user running has rights or runs with sudo.
    echo "  - Removing deprecated 'authJWTExclude'..."
    sudo sed -i '/authJWTExclude/d' "$MEDIAMTX_CONFIG"
    echo "  - Removing deprecated 'apiAllowOrigins' for safety..."
    sudo sed -i '/apiAllowOrigins/d' "$MEDIAMTX_CONFIG"
    echo "  - Fixing time unit '1d' to '24h'..."
    sudo sed -i 's/1d/24h/g' "$MEDIAMTX_CONFIG"
    echo "  ✅ MediaMTX config sanitized."
else
    echo "  ⚠️ WARNING: MediaMTX config not found at $MEDIAMTX_CONFIG. Skipping."
fi

# 3. Rebuild Frontend
echo "🏗️ Rebuilding frontend application..."
cd "$FRONTEND_DIR" || { echo "❌ ERROR: Frontend directory not found!"; exit 1; }
npm install
npm run build
cd ..
echo "  ✅ Frontend rebuild complete."

# 4. Update and Restart Nginx
echo "🌐 Overwriting Nginx configuration..."
if [ -f "$NGINX_CONFIG_SRC" ]; then
    sudo cp "$NGINX_CONFIG_SRC" "$NGINX_CONFIG_DEST"
    echo "  - Copied '$NGINX_CONFIG_SRC' to '$NGINX_CONFIG_DEST'."
    echo "  - Restarting Nginx service..."
    sudo systemctl restart nginx
    # Check Nginx status
    sudo systemctl status nginx --no-pager
    echo "  ✅ Nginx configuration updated and service restarted."
else
    echo "  ❌ ERROR: Source Nginx config '$NGINX_CONFIG_SRC' not found. Aborting."
    exit 1
fi

# 5. Flush PM2 Logs
echo "📜 Flushing PM2 logs..."
pm2 flush

# 6. Start Ecosystem
echo "♻️ Starting all services with PM2 ecosystem file..."
pm2 start "$ECOSYSTEM_CONFIG"

# 7. Verify MediaMTX Startup
echo "⏳ Waiting 5 seconds for services to initialize..."
sleep 5
echo "👀 Displaying latest MediaMTX logs..."
pm2 logs mediamtx --lines 15

echo "✅ Total System Fix v2 complete. Please check the logs above for any errors."
