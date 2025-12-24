#!/bin/bash
set -e
echo "🔧 Starting Repair Strategy..."

# Navigate to project root
cd "$(dirname "$0")/.."

# Stop services
echo "🛑 Stopping services..."
pm2 stop all || true
sudo systemctl stop nginx

# Kill lingering processes
echo "🔪 Killing lingering MediaMTX processes..."
pkill -f mediamtx || true

# Apply Nginx Config
echo "🌐 Applying Nginx configuration..."
sudo cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
sudo ln -sf /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# Start PM2
echo "🚀 Restarting PM2..."
pm2 delete all || true
pm2 start deployment/ecosystem.config.cjs --env production
pm2 save

echo "✅ Repair Complete!"
echo "🌍 Access via Domain: http://cctv.raf.my.id"
echo "🌍 Access via IP:     http://172.17.11.12"
