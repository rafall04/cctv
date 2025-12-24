#!/bin/bash
set -e
echo "🔧 Starting Final Repair Strategy..."

# Navigate to project root
cd "$(dirname "$0")/.."

# 1. Stop Services
echo "🛑 Stopping services..."
pm2 stop all || true

# 2. Fix MediaMTX Config (Replace '1d' with '24h' globally in the file)
echo "⏱️ Fixing MediaMTX time units..."
# We use a temporary file to ensure compatibility with both GNU and BSD sed
sed 's/1d/24h/g' deployment/mediamtx.yml > deployment/mediamtx.yml.tmp && mv deployment/mediamtx.yml.tmp deployment/mediamtx.yml
# Also fix the one in the mediamtx folder if it exists
if [ -f mediamtx/mediamtx.yml ]; then
    sed 's/1d/24h/g' mediamtx/mediamtx.yml > mediamtx/mediamtx.yml.tmp && mv mediamtx/mediamtx.yml.tmp mediamtx/mediamtx.yml
fi

# 3. Rebuild Frontend
echo "🏗 Rebuilding Frontend..."
cd frontend
npm install
npm run build
cd ..

# 4. Apply Nginx Config
echo "🌐 Applying Nginx configuration..."
sudo cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
sudo ln -sf /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 5. Start PM2 (Backend + MediaMTX only)
echo "🚀 Restarting PM2..."
pm2 delete all || true
pm2 start deployment/ecosystem.config.cjs --env production
pm2 save

echo "✅ Final Repair Complete!"
echo "🌍 Access via Domain: http://cctv.raf.my.id"
echo "🌍 Access via IP:     http://172.17.11.12"
