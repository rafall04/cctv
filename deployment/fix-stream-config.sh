#!/bin/bash
# ============================================
# RAF NET CCTV - Fix Stream Configuration
# ============================================
# This script fixes the stream URL configuration
# to ensure frontend never accesses MediaMTX directly
#
# Problem: Frontend was trying to access localhost:8888
# Solution: Backend returns relative URLs, nginx proxies to MediaMTX
# ============================================

set -e

echo "🔧 RAF NET CCTV - Stream Configuration Fix"
echo "==========================================="
echo ""

# Detect environment
if [ -d "/var/www/rafnet-cctv" ]; then
    APP_DIR="/var/www/rafnet-cctv"
    echo "📍 Production environment detected"
else
    APP_DIR="$(pwd)"
    echo "📍 Development environment detected"
fi

BACKEND_DIR="$APP_DIR/backend"
ENV_FILE="$BACKEND_DIR/.env"

echo "📂 Working directory: $APP_DIR"
echo ""

# Backup current .env
if [ -f "$ENV_FILE" ]; then
    BACKUP_FILE="$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$ENV_FILE" "$BACKUP_FILE"
    echo "📦 Backed up current .env to: $BACKUP_FILE"
fi

# Check for old/incorrect configuration
echo ""
echo "🔍 Checking current configuration..."

NEEDS_FIX=false

# Check for old variable names
if grep -q "^MEDIAMTX_HLS_URL=" "$ENV_FILE" 2>/dev/null; then
    echo "   ⚠️  Found old variable: MEDIAMTX_HLS_URL"
    NEEDS_FIX=true
fi

if grep -q "^MEDIAMTX_WEBRTC_URL=" "$ENV_FILE" 2>/dev/null; then
    echo "   ⚠️  Found old variable: MEDIAMTX_WEBRTC_URL"
    NEEDS_FIX=true
fi

# Check for absolute URLs in public config
if grep -q "PUBLIC_HLS_URL=http" "$ENV_FILE" 2>/dev/null; then
    echo "   ⚠️  Found absolute URL in PUBLIC_HLS_URL"
    NEEDS_FIX=true
fi

if grep -q "PUBLIC_WEBRTC_URL=http" "$ENV_FILE" 2>/dev/null; then
    echo "   ⚠️  Found absolute URL in PUBLIC_WEBRTC_URL"
    NEEDS_FIX=true
fi

# Check for localhost in public URLs
if grep -q "localhost:8888" "$ENV_FILE" 2>/dev/null; then
    echo "   ⚠️  Found localhost:8888 in config"
    NEEDS_FIX=true
fi

if [ "$NEEDS_FIX" = false ]; then
    # Verify correct config exists
    if grep -q "PUBLIC_HLS_URL=/hls" "$ENV_FILE" 2>/dev/null && \
       grep -q "PUBLIC_WEBRTC_URL=/webrtc" "$ENV_FILE" 2>/dev/null; then
        echo "   ✅ Configuration looks correct!"
        echo ""
        echo "Current stream URL configuration:"
        grep -E "^(PUBLIC_HLS_URL|PUBLIC_WEBRTC_URL|MEDIAMTX_)" "$ENV_FILE" || true
        echo ""
    else
        NEEDS_FIX=true
    fi
fi

if [ "$NEEDS_FIX" = true ]; then
    echo ""
    echo "🔧 Fixing configuration..."
    
    # Remove old variables
    sed -i '/^MEDIAMTX_HLS_URL=/d' "$ENV_FILE" 2>/dev/null || true
    sed -i '/^MEDIAMTX_WEBRTC_URL=/d' "$ENV_FILE" 2>/dev/null || true
    
    # Remove any existing PUBLIC_* variables (we'll add correct ones)
    sed -i '/^PUBLIC_HLS_URL=/d' "$ENV_FILE" 2>/dev/null || true
    sed -i '/^PUBLIC_WEBRTC_URL=/d' "$ENV_FILE" 2>/dev/null || true
    
    # Remove any existing internal URL variables
    sed -i '/^MEDIAMTX_HLS_URL_INTERNAL=/d' "$ENV_FILE" 2>/dev/null || true
    sed -i '/^MEDIAMTX_WEBRTC_URL_INTERNAL=/d' "$ENV_FILE" 2>/dev/null || true
    
    # Add correct configuration
    cat >> "$ENV_FILE" << 'EOF'

# MediaMTX Internal URLs (backend -> MediaMTX communication)
MEDIAMTX_HLS_URL_INTERNAL=http://localhost:8888
MEDIAMTX_WEBRTC_URL_INTERNAL=http://localhost:8889

# Public Stream URLs - MUST be relative paths!
# Frontend: /hls/camera1/index.m3u8 -> Nginx -> MediaMTX
PUBLIC_HLS_URL=/hls
PUBLIC_WEBRTC_URL=/webrtc
EOF

    echo "   ✅ Configuration updated!"
fi

echo ""
echo "📋 Final configuration:"
echo "------------------------"
grep -E "^(PUBLIC_HLS_URL|PUBLIC_WEBRTC_URL|MEDIAMTX_)" "$ENV_FILE" || echo "   (no MediaMTX config found)"
echo ""

# Restart backend if PM2 is available
if command -v pm2 &> /dev/null; then
    echo "🔄 Restarting backend service..."
    pm2 restart cctv-backend 2>/dev/null || pm2 restart all 2>/dev/null || echo "   ⚠️  Could not restart PM2 process"
    echo "   ✅ Backend restarted"
fi

echo ""
echo "✅ Stream configuration fix complete!"
echo ""
echo "📝 Architecture:"
echo "   1. Backend returns relative URLs: /hls/camera1/index.m3u8"
echo "   2. Frontend prepends API URL: https://api-cctv.raf.my.id/hls/camera1/index.m3u8"
echo "   3. Nginx proxies /hls/* to MediaMTX localhost:8888"
echo "   4. MediaMTX serves the stream"
echo ""
echo "🔒 Security: MediaMTX is never directly exposed to the internet"
echo ""
