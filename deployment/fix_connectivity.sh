#!/bin/bash
set -e
echo "🔧 Starting Connectivity Repair..."

# Navigate to project root
cd "$(dirname "$0")/.."

# 1. Stop PM2
echo "🛑 Stopping PM2..."
pm2 stop all || true

# 2. Apply Nginx Config
echo "🌐 Applying Nginx configuration..."
sudo cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
sudo ln -sf /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 3. Restart Backend
echo "🚀 Restarting Backend..."
pm2 restart rafnet-cctv-backend || pm2 start deployment/ecosystem.config.cjs --env production

echo "✅ Connectivity Repair Complete!"
echo "🌍 Frontend: http://cctv.raf.my.id (via Cloudflare)"
echo "🌍 Backend:  http://api-cctv.raf.my.id (via Cloudflare)"
