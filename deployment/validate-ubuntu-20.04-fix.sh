#!/bin/bash

# =================================================================
# RAF NET CCTV - Ubuntu 20.04 Fix Validation Script
# =================================================================
# 
# This script validates that all Ubuntu 20.04 fixes are working
# 
# =================================================================

set -e

echo "🔍 RAF NET CCTV - Ubuntu 20.04 Fix Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check system requirements
echo "📋 System Requirements Check:"

# Node.js version
NODE_VERSION=$(node --version 2>/dev/null || echo "not installed")
echo "   Node.js: $NODE_VERSION"
if [[ $NODE_VERSION == v18* ]] || [[ $NODE_VERSION == v20* ]]; then
    echo "   ✅ Node.js version compatible"
else
    echo "   ❌ Node.js version incompatible (need 18+)"
fi

# PM2
PM2_VERSION=$(pm2 --version 2>/dev/null || echo "not installed")
echo "   PM2: $PM2_VERSION"

# Build tools
if command -v gcc &> /dev/null && command -v python3 &> /dev/null; then
    echo "   ✅ Build tools available"
else
    echo "   ❌ Build tools missing"
fi

echo ""
echo "📦 Dependencies Check:"

# Backend dependencies
if [ -d "backend/node_modules" ]; then
    echo "   ✅ Backend dependencies installed"
    
    # Test critical native modules
    cd backend
    if node -e "require('better-sqlite3')" 2>/dev/null; then
        echo "   ✅ better-sqlite3 working"
    else
        echo "   ❌ better-sqlite3 not working"
    fi
    
    if node -e "require('bcrypt')" 2>/dev/null; then
        echo "   ✅ bcrypt working"
    else
        echo "   ❌ bcrypt not working"
    fi
    cd ..
else
    echo "   ❌ Backend dependencies not installed"
fi

# Frontend build
if [ -d "frontend/dist" ]; then
    echo "   ✅ Frontend build exists"
else
    echo "   ❌ Frontend build missing"
fi

# MediaMTX
if [ -f "mediamtx/mediamtx" ]; then
    echo "   ✅ MediaMTX binary exists"
    if [ -x "mediamtx/mediamtx" ]; then
        echo "   ✅ MediaMTX binary executable"
    else
        echo "   ❌ MediaMTX binary not executable"
    fi
else
    echo "   ❌ MediaMTX binary missing"
fi

echo ""
echo "⚙️ Configuration Check:"

# Environment files
if [ -f "backend/.env" ]; then
    echo "   ✅ Backend environment configured"
else
    echo "   ❌ Backend environment missing"
fi

if [ -f "frontend/.env.production" ]; then
    echo "   ✅ Frontend environment configured"
else
    echo "   ❌ Frontend environment missing"
fi

# MediaMTX config
if [ -f "mediamtx/mediamtx.yml" ]; then
    echo "   ✅ MediaMTX configuration exists"
    if grep -q "24h" mediamtx/mediamtx.yml; then
        echo "   ✅ MediaMTX time format fixed (24h)"
    else
        echo "   ⚠️  MediaMTX time format may need checking"
    fi
else
    echo "   ❌ MediaMTX configuration missing"
fi

# Nginx config
if [ -f "/etc/nginx/sites-available/rafnet-cctv" ]; then
    echo "   ✅ Nginx configuration exists"
else
    echo "   ❌ Nginx configuration missing"
fi

echo ""
echo "🚀 Service Status Check:"

# PM2 processes
if command -v pm2 &> /dev/null; then
    PM2_STATUS=$(pm2 jlist 2>/dev/null || echo "[]")
    BACKEND_STATUS=$(echo $PM2_STATUS | jq -r '.[] | select(.name=="rafnet-cctv-backend") | .pm2_env.status' 2>/dev/null || echo "not found")
    MEDIAMTX_STATUS=$(echo $PM2_STATUS | jq -r '.[] | select(.name=="mediamtx") | .pm2_env.status' 2>/dev/null || echo "not found")
    
    echo "   Backend PM2: $BACKEND_STATUS"
    echo "   MediaMTX PM2: $MEDIAMTX_STATUS"
else
    echo "   ❌ PM2 not available"
fi

# Nginx status
if systemctl is-active --quiet nginx 2>/dev/null; then
    echo "   ✅ Nginx running"
else
    echo "   ❌ Nginx not running"
fi

echo ""
echo "🌐 Network Connectivity Check:"

# Test local endpoints
if curl -s http://127.0.0.1:3000/health > /dev/null 2>&1; then
    echo "   ✅ Backend responding (localhost:3000)"
else
    echo "   ❌ Backend not responding (localhost:3000)"
fi

if curl -s http://127.0.0.1:9997/v3/config > /dev/null 2>&1; then
    echo "   ✅ MediaMTX API responding (localhost:9997)"
else
    echo "   ❌ MediaMTX API not responding (localhost:9997)"
fi

if curl -s -H "Host: cctv.raf.my.id" http://127.0.0.1/ > /dev/null 2>&1; then
    echo "   ✅ Nginx frontend proxy working"
else
    echo "   ❌ Nginx frontend proxy not working"
fi

if curl -s -H "Host: api-cctv.raf.my.id" http://127.0.0.1/health > /dev/null 2>&1; then
    echo "   ✅ Nginx backend proxy working"
else
    echo "   ❌ Nginx backend proxy not working"
fi

echo ""
echo "📊 System Resources:"
echo "   Memory: $(free -h | grep '^Mem:' | awk '{print $3 "/" $2}')"
echo "   Disk: $(df -h / | tail -1 | awk '{print $3 "/" $2 " (" $5 " used)"}')"
echo "   Load: $(uptime | awk -F'load average:' '{print $2}')"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Validation Complete"
echo ""
echo "🎯 Next Steps if all checks pass:"
echo "   1. Update DNS A records"
echo "   2. Run: sudo certbot --nginx"
echo "   3. Configure firewall"
echo "   4. Test with camera RTSP URLs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"