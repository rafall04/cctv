#!/bin/bash
set -e

echo "🚀 RAF NET CCTV - Production Deployment"
echo "========================================"

if [[ $EUID -ne 0 ]]; then
   echo "❌ Run as root"
   exit 1
fi

PROJECT_ROOT="/var/www/rafnet-cctv"
cd "$PROJECT_ROOT"

echo "📦 Step 1: Backend setup..."
cd backend
cp ../deployment/backend.env.prod .env
npm install --production --silent
npm run setup-db 2>/dev/null || true

echo "🎨 Step 2: Frontend build..."
cd ../frontend
cp ../deployment/frontend.env.prod .env
npm install --silent
npm run build

echo "⚙️ Step 3: Nginx config..."
cp ../deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
ln -sf /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo "🔄 Step 4: Restart services..."
cd "$PROJECT_ROOT"
pm2 delete all 2>/dev/null || true
pm2 start deployment/ecosystem.config.cjs
pm2 save

echo ""
echo "✅ Deployment complete!"
echo "   Frontend: https://cctv.raf.my.id"
echo "   API: https://api-cctv.raf.my.id"
