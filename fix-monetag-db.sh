#!/bin/bash
# Fix monetag database structure

echo "🔧 Ensuring monetag_settings table structure..."

ssh root@172.17.11.12 << 'EOF'
cd /var/www/rafnet-cctv

echo "📥 Pulling latest changes..."
git pull origin main

echo ""
echo "🔄 Running monetag_settings migration..."
cd backend
node database/migrations/ensure_monetag_settings.js

echo ""
echo "🔄 Restarting backend..."
cd /var/www/rafnet-cctv
pm2 restart rafnet-cctv-backend

echo ""
echo "✅ Database migration completed!"
echo ""
echo "Access Monetag settings:"
echo "  https://cctv.raf.my.id/admin/monetag"
EOF
