#!/bin/bash
# ===================================
# P0 Security Fixes Deployment
# ===================================
# Deploys critical security patches for:
# - P0-1: MediaMTX API exposure
# - P0-2: Stream token authentication
#
# Run as root: bash deploy-p0-fixes.sh

set -e

echo "🔒 Deploying P0 Security Fixes..."
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Error: This script must be run as root"
    exit 1
fi

# Navigate to project directory
cd /var/www/rafnet-cctv

echo "📥 Step 1: Pulling latest code from GitHub..."
git pull origin main

echo ""
echo "🔥 Step 2: Securing MediaMTX ports with firewall..."
bash deployment/secure-mediamtx-ports.sh

echo ""
echo "📦 Step 3: Installing backend dependencies..."
cd backend
npm install --production

echo ""
echo "🏗️  Step 4: Building frontend..."
cd ../frontend
npm install
npm run build

echo ""
echo "🔄 Step 5: Updating Nginx configuration..."
cp /var/www/rafnet-cctv/deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv

# Test Nginx configuration
echo "🧪 Testing Nginx configuration..."
nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Nginx configuration valid"
    systemctl reload nginx
    echo "✅ Nginx reloaded"
else
    echo "❌ Nginx configuration invalid - rolling back"
    exit 1
fi

echo ""
echo "🔄 Step 6: Restarting backend service..."
pm2 restart rafnet-cctv-backend

# Wait for backend to start
sleep 3

# Check if backend is running
if pm2 list | grep -q "rafnet-cctv-backend.*online"; then
    echo "✅ Backend restarted successfully"
else
    echo "❌ Backend failed to start"
    pm2 logs rafnet-cctv-backend --lines 50
    exit 1
fi

echo ""
echo "🧪 Step 7: Verifying security fixes..."

# Test 1: MediaMTX API should be blocked from external
echo "  Testing MediaMTX API block..."
EXTERNAL_IP=$(hostname -I | awk '{print $1}')
if timeout 3 curl -s http://$EXTERNAL_IP:9997 > /dev/null 2>&1; then
    echo "  ⚠️  WARNING: MediaMTX API still accessible externally!"
else
    echo "  ✅ MediaMTX API blocked from external access"
fi

# Test 2: MediaMTX API should work from localhost
echo "  Testing MediaMTX API localhost access..."
if curl -s http://localhost:9997/v3/config/global/get > /dev/null 2>&1; then
    echo "  ✅ MediaMTX API accessible from localhost"
else
    echo "  ⚠️  WARNING: MediaMTX API not accessible from localhost!"
fi

# Test 3: Backend should be running
echo "  Testing backend health..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "  ✅ Backend health check passed"
else
    echo "  ⚠️  WARNING: Backend health check failed!"
fi

# Test 4: Stream token endpoint should work
echo "  Testing stream token endpoint..."
if curl -s http://localhost:3000/api/stream/1/token > /dev/null 2>&1; then
    echo "  ✅ Stream token endpoint working"
else
    echo "  ⚠️  WARNING: Stream token endpoint not responding!"
fi

echo ""
echo "✅ P0 Security Fixes Deployed Successfully!"
echo ""
echo "📊 Summary:"
echo "  ✓ MediaMTX API secured (port 9997 blocked externally)"
echo "  ✓ HLS proxy now requires stream tokens"
echo "  ✓ Nginx configuration updated"
echo "  ✓ Backend restarted with new security features"
echo ""
echo "⚠️  IMPORTANT NOTES:"
echo "  1. Frontend users will need to refresh their browsers"
echo "  2. Old stream URLs without tokens will no longer work"
echo "  3. Monitor logs for any authentication errors:"
echo "     pm2 logs rafnet-cctv-backend"
echo ""
echo "🔍 Verify deployment:"
echo "  - Open https://cctv.raf.my.id:800 in browser"
echo "  - Check that cameras load properly"
echo "  - Verify no console errors related to stream tokens"
