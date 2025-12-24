#!/bin/bash
# =================================================================
#
# Title: fix_definitive.sh
#
# Description: This script provides a definitive, stable solution
#              for deploying the RAF NET CCTV Hub. It deploys a
#              known-good, minimal configuration for MediaMTX,
#              sets up a universal Nginx server block, and restarts
#              all services in the correct order. This approach
#              avoids version conflicts by using a clean config file.
#
# Actions:
#   1. Stops all PM2 managed processes.
#   2. Deploys a clean, stable MediaMTX configuration file.
#   3. Rebuilds the frontend application.
#   4. Overwrites the default Nginx configuration and restarts Nginx.
#   5. Flushes PM2 logs.
#   6. Starts all applications via the PM2 ecosystem file.
#   7. Displays the latest MediaMTX logs to confirm success.
#
# Usage:
#   Run this script from the project root directory with sudo.
#   bash fix_definitive.sh
#
# =================================================================

# --- Paths ---
MEDIAMTX_CONFIG_SRC="mediamtx/mediamtx.yml"
MEDIAMTX_CONFIG_DEST_DIR="/var/www/rafnet-cctv/mediamtx"
MEDIAMTX_CONFIG_DEST_FILE="$MEDIAMTX_CONFIG_DEST_DIR/mediamtx.yml"
NGINX_CONFIG_SRC="deployment/nginx.conf"
NGINX_CONFIG_DEST="/etc/nginx/sites-available/default"
FRONTEND_DIR="frontend"
ECOSYSTEM_CONFIG="deployment/ecosystem.config.cjs"

# --- Script Start ---
echo "🚀 Starting Definitive System Fix for RAF NET CCTV Hub..."
set -e # Exit immediately if a command exits with a non-zero status.

# 1. Stop all PM2 services
echo "🛑 Stopping all PM2 services..."
pm2 stop all

# 2. Deploy Clean MediaMTX Configuration
echo "🔧 Deploying clean MediaMTX config..."
if [ -f "$MEDIAMTX_CONFIG_SRC" ]; then
    echo "  - Ensuring destination directory exists: $MEDIAMTX_CONFIG_DEST_DIR"
    sudo mkdir -p "$MEDIAMTX_CONFIG_DEST_DIR"
    echo "  - Copying '$MEDIAMTX_CONFIG_SRC' to '$MEDIAMTX_CONFIG_DEST_FILE'"
    sudo cp "$MEDIAMTX_CONFIG_SRC" "$MEDIAMTX_CONFIG_DEST_FILE"
    echo "  ✅ MediaMTX config deployed successfully."
else
    echo "  ❌ ERROR: Source MediaMTX config '$MEDIAMTX_CONFIG_SRC' not found. Aborting."
    exit 1
fi

# 3. Rebuild Frontend
echo "🏗️ Rebuilding frontend application..."
cd "$FRONTEND_DIR"
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
    echo "  - Checking Nginx status..."
    sudo systemctl status nginx --no-pager | cat
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
pm2 logs mediamtx --lines 20

echo "✅ Definitive System Fix complete. Please check the logs above for any errors."
