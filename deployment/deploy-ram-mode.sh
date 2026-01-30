#!/bin/bash
# RAF NET CCTV - Deploy RAM Mode to Production
# Server: 172.17.11.12 (root@aldihosting)

set -e

echo "🚀 RAF NET CCTV - Deploying RAM Mode"
echo "====================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Error: This script must be run as root"
    exit 1
fi

# Navigate to project directory
cd /var/www/rafnet-cctv

echo "📥 Step 1: Pull latest code from GitHub..."
git pull origin main
echo "✅ Code updated"
echo ""

echo "📁 Step 2: Setup RAM disk directories..."
cd deployment
chmod +x setup-ram-disk.sh
./setup-ram-disk.sh
echo ""

echo "⚙️  Step 3: Backup and update MediaMTX config..."
# Backup existing config
if [ -f /var/www/rafnet-cctv/mediamtx/mediamtx.yml ]; then
    cp /var/www/rafnet-cctv/mediamtx/mediamtx.yml /var/www/rafnet-cctv/mediamtx/mediamtx.yml.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ Backup created: mediamtx.yml.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Copy new config
cp /var/www/rafnet-cctv/deployment/mediamtx.yml /var/www/rafnet-cctv/mediamtx/mediamtx.yml
echo "✅ MediaMTX config updated"

# Restart MediaMTX
echo "🔄 Restarting MediaMTX..."
pm2 restart rafnet-cctv-mediamtx
sleep 3
echo "✅ MediaMTX restarted"
echo ""

echo "🚀 Step 4: Backup and update Nginx config..."
# Backup existing config
if [ -f /etc/nginx/sites-available/rafnet-cctv ]; then
    cp /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-available/rafnet-cctv.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ Backup created: rafnet-cctv.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Copy new config
cp /var/www/rafnet-cctv/deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
echo "✅ Nginx config updated"

# Test Nginx config
echo "🧪 Testing Nginx configuration..."
nginx -t
if [ $? -ne 0 ]; then
    echo "❌ Nginx config test failed! Restoring backup..."
    cp /etc/nginx/sites-available/rafnet-cctv.backup.$(date +%Y%m%d_%H%M%S) /etc/nginx/sites-available/rafnet-cctv
    exit 1
fi
echo "✅ Nginx config test passed"

# Reload Nginx
echo "🔄 Reloading Nginx..."
systemctl reload nginx
echo "✅ Nginx reloaded"
echo ""

echo "📺 Step 5: Rebuild frontend..."
cd /var/www/rafnet-cctv/frontend
npm run build
echo "✅ Frontend rebuilt"
echo ""

echo "🔄 Step 6: Restart backend..."
pm2 restart rafnet-cctv-backend
echo "✅ Backend restarted"
echo ""

echo "✅ Deployment completed!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Verification Steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Verification 1: Check RAM disk
echo "1️⃣  RAM Disk Status:"
df -h /dev/shm | tail -1
echo ""

# Verification 2: Check MediaMTX HLS directory
echo "2️⃣  MediaMTX HLS Directory:"
if [ -d /dev/shm/mediamtx-live ]; then
    echo "✅ /dev/shm/mediamtx-live exists"
    ls -la /dev/shm/mediamtx-live/ | head -5
else
    echo "❌ /dev/shm/mediamtx-live NOT FOUND"
fi
echo ""

# Verification 3: Check Nginx cache directory
echo "3️⃣  Nginx Cache Directory:"
if [ -d /dev/shm/nginx-cache ]; then
    echo "✅ /dev/shm/nginx-cache exists"
    ls -la /dev/shm/nginx-cache/ | head -5
else
    echo "❌ /dev/shm/nginx-cache NOT FOUND"
fi
echo ""

# Verification 4: Check MediaMTX config
echo "4️⃣  MediaMTX HLS Directory Config:"
curl -s http://localhost:9997/v3/config/global/get | grep -o '"hlsDirectory":"[^"]*"' || echo "❌ Cannot verify MediaMTX config"
echo ""

# Verification 5: Test HLS stream with cache header
echo "5️⃣  Testing HLS Stream (first request - should be MISS):"
curl -I http://localhost:800/hls/camera1/index.m3u8 2>&1 | grep -E "(HTTP|X-Cache-Status)" || echo "⚠️  Stream not available yet"
echo ""

echo "6️⃣  Testing HLS Stream (second request - should be HIT):"
sleep 1
curl -I http://localhost:800/hls/camera1/index.m3u8 2>&1 | grep -E "(HTTP|X-Cache-Status)" || echo "⚠️  Stream not available yet"
echo ""

# Verification 6: Check PM2 status
echo "7️⃣  PM2 Process Status:"
pm2 status | grep -E "(rafnet-cctv|Status)"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ RAM Mode Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next Steps:"
echo "  1. Open browser: http://cctv.raf.my.id:800"
echo "  2. Play a camera stream"
echo "  3. Check Network tab for X-Cache-Status header"
echo "  4. Monitor RAM usage: watch -n 1 'df -h /dev/shm'"
echo ""
echo "📊 Expected Performance:"
echo "  - Initial load: 1-2 seconds (was 3-5s)"
echo "  - Segment fetch: 10-50ms (was 200-500ms)"
echo "  - Disk I/O: 0ms (was 50-200ms)"
echo ""
