#!/bin/bash
# =================================================================
#
# Title: fix_final_v3.sh
#
# Description: This script PERMANENTLY fixes the RAF NET CCTV Hub
#              by overwriting outdated configurations with clean,
#              stable versions for both MediaMTX and Nginx.
#
# Actions:
#   1. Stops all PM2 managed processes.
#   2. Backs up the old mediamtx.yml.
#   3. Writes a new, v1.x compatible mediamtx.yml.
#   4. Deploys a new Nginx config with explicit server names.
#   5. Links the new Nginx config and removes the default site.
#   6. Restarts all services and verifies their status.
#
# Usage:
#   Run this script from the project root with sudo.
#   sudo bash fix_final_v3.sh
#
# =================================================================

set -e # Exit immediately if a command exits with a non-zero status.

# --- Paths ---
MEDIAMTX_CONFIG_DIR="/var/www/rafnet-cctv/mediamtx"
MEDIAMTX_CONFIG_FILE="$MEDIAMTX_CONFIG_DIR/mediamtx.yml"
MEDIAMTX_BACKUP_FILE="$MEDIAMTX_CONFIG_DIR/mediamtx.yml.bak"

NGINX_SRC_CONFIG="deployment/nginx.conf"
NGINX_DEST_CONFIG="/etc/nginx/sites-available/rafnet-cctv"
NGINX_ENABLED_LINK="/etc/nginx/sites-enabled/rafnet-cctv"
NGINX_DEFAULT_LINK="/etc/nginx/sites-enabled/default"

ECOSYSTEM_CONFIG="deployment/ecosystem.config.cjs"

# --- Script Start ---
echo "🚀 Starting Final System Fix v3 for RAF NET CCTV Hub..."

# 1. Stop all PM2 services
echo "🛑 Stopping all PM2 services..."
pm2 stop all || echo "PM2 not running."

# 2. Backup and Overwrite MediaMTX Configuration
echo "🔧 Fixing MediaMTX: Backing up and writing new config..."
sudo mkdir -p "$MEDIAMTX_CONFIG_DIR"
if [ -f "$MEDIAMTX_CONFIG_FILE" ]; then
    echo "  - Backing up old config to $MEDIAMTX_BACKUP_FILE"
    sudo cp "$MEDIAMTX_CONFIG_FILE" "$MEDIAMTX_BACKUP_FILE"
fi

echo "  - Writing new, clean mediamtx.yml..."
sudo tee "$MEDIAMTX_CONFIG_FILE" > /dev/null <<EOF
paths:
  all:

api: yes
apiAddress: :9997
rtsp: yes
rtspAddress: :8554
hls: yes
hlsAddress: :8888
webrtc: yes
webrtcAddress: :8889
logLevel: info
EOF
echo "  ✅ MediaMTX config has been permanently fixed."

# 3. Deploy and Link Nginx Configuration
echo "🌐 Fixing Nginx: Deploying explicit server config..."
if [ -f "$NGINX_SRC_CONFIG" ]; then
    echo "  - Copying new Nginx config to $NGINX_DEST_CONFIG"
    sudo cp "$NGINX_SRC_CONFIG" "$NGINX_DEST_CONFIG"
    
    echo "  - Enabling new site configuration..."
    sudo ln -sf "$NGINX_DEST_CONFIG" "$NGINX_ENABLED_LINK"
    
    if [ -L "$NGINX_DEFAULT_LINK" ]; then
        echo "  - Removing default Nginx site..."
        sudo rm "$NGINX_DEFAULT_LINK"
    fi
    
    echo "  - Restarting Nginx service..."
    sudo systemctl restart nginx
    echo "  - Verifying Nginx status..."
    sudo systemctl status nginx --no-pager | cat
    echo "  ✅ Nginx deployment complete."
else
    echo "  ❌ ERROR: Source Nginx config '$NGINX_SRC_CONFIG' not found. Aborting."
    exit 1
fi

# 4. Start Ecosystem and Verify
echo "♻️ Starting all services with PM2..."
pm2 flush
pm2 start "$ECOSYSTEM_CONFIG"

echo "⏳ Waiting 3 seconds for services to initialize..."
sleep 3
echo "👀 Displaying final PM2 status..."
pm2 status

echo "✅ Final System Fix v3 complete. All services should now be stable."
