#!/bin/bash
set -e
echo "🔧 Starting Final Fix Strategy..."

# Navigate to project root
cd "$(dirname "$0")/.."

# 1. Stop Services
echo "🛑 Stopping services..."
pm2 stop all || true

# 2. Fix MediaMTX Config (Replace '1d' with '24h' globally)
echo "⏱️ Fixing MediaMTX time units..."
# Fix in deployment folder
sed 's/1d/24h/g' deployment/mediamtx.yml > deployment/mediamtx.yml.tmp && mv deployment/mediamtx.yml.tmp deployment/mediamtx.yml
# Fix in mediamtx folder
if [ -f mediamtx/mediamtx.yml ]; then
    sed 's/1d/24h/g' mediamtx/mediamtx.yml > mediamtx/mediamtx.yml.tmp && mv mediamtx/mediamtx.yml.tmp mediamtx/mediamtx.yml
fi

# 3. Apply Nginx Config
echo "🌐 Applying Nginx configuration..."
sudo cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
sudo ln -sf /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 4. Start PM2
echo "🚀 Restarting PM2..."
pm2 delete all || true
pm2 start deployment/ecosystem.config.cjs --env production
pm2 save

echo "✅ Final Fix Complete!"
echo "🌍 Frontend: http://cctv.raf.my.id (Cloudflare handles HTTPS)"
echo "🌍 Backend:  http://api-cctv.raf.my.id (Cloudflare handles HTTPS)"
