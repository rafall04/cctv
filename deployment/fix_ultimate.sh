#!/bin/bash
set -e
echo "🔧 Starting Ultimate Fix Strategy..."

# Navigate to project root
cd "$(dirname "$0")/.."

# 1. Stop Services
echo "🛑 Stopping services..."
pm2 stop all || true

# 2. Repair MediaMTX Config
echo "⏱️ Repairing MediaMTX config..."
# Remove invalid field 'apiAllowOrigins'
if [ -f mediamtx/mediamtx.yml ]; then
    sed -i '/apiAllowOrigins/d' mediamtx/mediamtx.yml
fi
if [ -f deployment/mediamtx.yml ]; then
    sed -i '/apiAllowOrigins/d' deployment/mediamtx.yml
fi

# Fix duration syntax (1d -> 24h)
if [ -f mediamtx/mediamtx.yml ]; then
    sed -i 's/1d/24h/g' mediamtx/mediamtx.yml
fi
if [ -f deployment/mediamtx.yml ]; then
    sed -i 's/1d/24h/g' deployment/mediamtx.yml
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

# 5. Start PM2
echo "🚀 Restarting PM2..."
pm2 delete all || true
pm2 start deployment/ecosystem.config.cjs --env production
pm2 save

echo "✅ Ultimate Fix Complete!"
echo "🌍 Frontend: http://cctv.raf.my.id (Cloudflare handles HTTPS)"
echo "🌍 Backend:  http://api-cctv.raf.my.id"
