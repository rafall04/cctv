#!/bin/bash
# Update production server with latest changes

echo "🔄 Updating production server..."

ssh root@172.17.11.12 << 'EOF'
cd /var/www/rafnet-cctv

echo "📥 Pulling latest changes from GitHub..."
git fetch origin
git reset --hard origin/main

echo "🔄 Restarting backend..."
pm2 restart rafnet-cctv-backend

sleep 3

echo "📊 Checking backend status..."
pm2 logs rafnet-cctv-backend --lines 30 --nostream

echo ""
echo "✅ Production update complete!"
EOF
