#!/bin/bash
# =================================================================
#
# Title: fix_streaming_logic.sh
#
# Description: This script restores the on-demand streaming logic
#              by re-linking MediaMTX to the backend and adds the
#              necessary Nginx configuration for HLS delivery.
#
# Actions:
#   1. Stops all PM2 managed processes.
#   2. Deploys the updated MediaMTX config with 'runOnDemand'.
#   3. Deploys the updated Nginx config with the '/hls/' proxy.
#   4. Restarts all services.
#   5. Provides instructions for final verification.
#
# Usage:
#   Run this script from the project root with sudo.
#   sudo bash fix_streaming_logic.sh
#
# =================================================================

set -e # Exit immediately if a command exits with a non-zero status.

# --- Paths ---
MEDIAMTX_SRC_CONFIG="mediamtx/mediamtx.yml"
MEDIAMTX_DEST_CONFIG="/var/www/rafnet-cctv/mediamtx/mediamtx.yml"
NGINX_SRC_CONFIG="deployment/nginx.conf"
NGINX_DEST_CONFIG="/etc/nginx/sites-available/rafnet-cctv"
ECOSYSTEM_CONFIG="deployment/ecosystem.config.cjs"

# --- Script Start ---
echo "🚀 Starting Streaming Logic Fix for RAF NET CCTV Hub..."

# 1. Stop all PM2 services
echo "🛑 Stopping all PM2 services..."
pm2 stop all || echo "PM2 not running."


# 3. Deploy Updated Nginx Configuration
echo "🌐 Applying HLS proxy block to Nginx..."
if [ -f "$NGINX_SRC_CONFIG" ]; then
    sudo cp "$NGINX_SRC_CONFIG" "$NGINX_DEST_CONFIG"
    echo "  - Restarting Nginx service to apply changes..."
    sudo systemctl restart nginx
    echo "  ✅ Nginx configuration updated."
else
    echo "  ❌ ERROR: Source Nginx config '$NGINX_SRC_CONFIG' not found. Aborting."
    exit 1
fi

# 4. Start All Services
echo "♻️ Starting all services with PM2..."
pm2 flush
pm2 start "$ECOSYSTEM_CONFIG"

# 5. Final Verification Instructions
echo ""
echo "✅ Deployment complete. Services are restarting."
echo "---"
echo "⚠️ IMPORTANT: VERIFICATION REQUIRED"
echo "The 'runOnDemand' command in 'mediamtx.yml' has been set to:"
echo ""
echo "    node /var/www/rafnet-cctv/backend/sync_mediamtx.js"
echo ""
echo "Please manually verify that 'sync_mediamtx.js' is the correct script for dynamically fetching stream sources. If it is not, update 'mediamtx/mediamtx.yml' with the correct path and re-run this script."
echo "---"
