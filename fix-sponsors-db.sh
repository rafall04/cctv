#!/bin/bash
# Fix sponsors database structure

echo "🔧 Fixing sponsors database structure..."

ssh root@172.17.11.12 << 'EOF'
cd /var/www/rafnet-cctv

echo "📥 Pulling latest changes..."
git pull origin main

echo ""
echo "🔄 Running sponsors table migration..."
cd backend
node database/migrations/fix_sponsors_table.js

echo ""
echo "🔄 Restarting backend..."
cd /var/www/rafnet-cctv
pm2 restart rafnet-cctv-backend

echo ""
echo "✅ Database fix completed!"
echo ""
echo "Test sponsor creation:"
echo "  curl -X POST https://cctv.raf.my.id/api/sponsors \\"
echo "    -H 'Authorization: Bearer YOUR_TOKEN' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"name\":\"Test Sponsor\",\"package\":\"bronze\",\"price\":100000}'"
EOF
