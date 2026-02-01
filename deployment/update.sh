#!/bin/bash
# RAF NET CCTV - Update Script
# Run as root: bash update.sh

set -e

APP_DIR="/var/www/cctv"

echo "🔄 RAF NET CCTV - Update"
echo "========================"

cd "$APP_DIR"

# Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# Update backend
echo "🔧 Updating backend..."
cd backend
npm install --production

# Update frontend
echo "🎨 Building frontend..."
cd ../frontend
npm install
npm run build

# Restart services
echo "♻️ Restarting services..."
pm2 restart cctv-backend
pm2 restart cctv-mediamtx

# Reload Nginx
echo "🔄 Reloading Nginx..."
nginx -t && systemctl reload nginx

echo ""
echo "✅ Update completed!"
echo ""
pm2 status
