#!/bin/bash
# Deploy frontend to production with rebuild

echo "🚀 Deploying frontend to production..."

ssh root@172.17.11.12 << 'EOF'
cd /var/www/rafnet-cctv

echo "📥 Pulling latest changes..."
git fetch origin
git reset --hard origin/main

echo "📦 Installing frontend dependencies..."
cd frontend
npm install --production=false

echo "🔨 Building frontend..."
npm run build

echo "📋 Checking if sw.js exists in dist..."
if [ -f "dist/sw.js" ]; then
    echo "✅ sw.js found in dist/"
    ls -lh dist/sw.js
else
    echo "⚠️  sw.js not found in dist/, copying from public/"
    cp public/sw.js dist/sw.js
    ls -lh dist/sw.js
fi

echo "🔄 Updating Nginx configuration..."
cd /var/www/rafnet-cctv
cp deployment/nginx.conf /etc/nginx/sites-available/cctv

echo "✅ Testing Nginx configuration..."
nginx -t

if [ $? -eq 0 ]; then
    echo "🔄 Reloading Nginx..."
    systemctl reload nginx
    echo "✅ Nginx reloaded successfully"
else
    echo "❌ Nginx configuration test failed!"
    exit 1
fi

echo ""
echo "✅ Frontend deployment complete!"
echo "🌐 Check: https://cctv.raf.my.id/sw.js"
EOF
