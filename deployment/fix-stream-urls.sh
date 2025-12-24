#!/bin/bash

# =================================================================
# RAF NET CCTV - Fix Stream URLs Configuration
# =================================================================
# 
# This script updates the backend configuration to use proper
# public URLs for HLS/WebRTC streams through nginx proxy.
# 
# =================================================================

echo "🔧 RAF NET CCTV - Fix Stream URLs Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PROJECT_ROOT="/var/www/rafnet-cctv"
cd "$PROJECT_ROOT"

# 1. Update backend .env with correct stream URLs
echo "🔧 Step 1: Updating backend .env configuration..."

# Backup existing .env
if [ -f "backend/.env" ]; then
    cp backend/.env backend/.env.backup.$(date +%Y%m%d_%H%M%S)
fi

# Create new .env with correct configuration
cat > backend/.env << 'EOF'
# RAF NET CCTV Backend Configuration - Ubuntu 20.04 Production

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Database
DATABASE_PATH=/var/www/rafnet-cctv/data/cctv.db

# JWT Configuration
JWT_SECRET=rafnet-cctv-production-secret-change-this
JWT_EXPIRATION=24h

# MediaMTX Configuration
# Internal URLs - for backend to communicate with MediaMTX
MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_HLS_URL_INTERNAL=http://localhost:8888
MEDIAMTX_WEBRTC_URL_INTERNAL=http://localhost:8889

# Public URLs - returned to frontend clients (through nginx proxy)
# These are relative paths that nginx will proxy to MediaMTX
MEDIAMTX_HLS_URL=/hls
MEDIAMTX_WEBRTC_URL=/webrtc

# CORS - Accept all origins
CORS_ORIGIN=*
EOF

echo "   ✅ Backend .env updated"

# 2. Restart backend to apply changes
echo ""
echo "🔧 Step 2: Restarting backend..."
pm2 restart rafnet-cctv-backend

# Wait for restart
sleep 3

# 3. Verify configuration
echo ""
echo "🔧 Step 3: Verifying configuration..."

# Test API endpoint
echo "   Testing /api/stream endpoint..."
STREAM_RESPONSE=$(curl -s http://localhost:3000/api/stream)
echo "   Response: $STREAM_RESPONSE" | head -c 200
echo ""

# Check if URLs are correct (should be /hls/... not localhost:8888/...)
if echo "$STREAM_RESPONSE" | grep -q '"/hls/'; then
    echo "   ✅ Stream URLs are correctly configured (using /hls proxy)"
else
    echo "   ⚠️  Stream URLs may not be correctly configured"
    echo "   Expected: /hls/camera.../index.m3u8"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Stream URL Configuration Complete!"
echo ""
echo "📋 Configuration Summary:"
echo "   Frontend accesses: /hls/camera{id}/index.m3u8"
echo "   Nginx proxies /hls/* to MediaMTX localhost:8888"
echo "   Backend returns relative URLs, not localhost URLs"
echo ""
echo "🔧 If streams still don't work:"
echo "   1. Check nginx is proxying /hls/ correctly"
echo "   2. Check MediaMTX is running on port 8888"
echo "   3. Rebuild frontend: cd frontend && npm run build"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
