#!/bin/bash
# Deploy Stream Token Authentication (P0-2 Fix)
# Run as root on Ubuntu 20.04

set -e

echo "🔐 Deploying Stream Token Authentication..."

cd /var/www/rafnet-cctv

# Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# Install jsonwebtoken dependency
echo "📦 Installing jsonwebtoken..."
cd backend
npm install jsonwebtoken@^9.0.2

# Restart backend
echo "🔄 Restarting backend..."
pm2 restart rafnet-cctv-backend

# Wait for backend to start
sleep 3

# Verify backend is running
echo "✅ Verifying backend..."
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Backend is healthy"
else
    echo "❌ Backend health check failed"
    pm2 logs rafnet-cctv-backend --lines 50
    exit 1
fi

# Test token endpoint
echo "🧪 Testing token endpoint..."
TOKEN_RESPONSE=$(curl -s http://localhost:3000/api/stream/1/token)
if echo "$TOKEN_RESPONSE" | grep -q '"success":true'; then
    echo "✅ Token endpoint working"
    echo "$TOKEN_RESPONSE" | head -c 200
    echo ""
else
    echo "❌ Token endpoint failed"
    echo "$TOKEN_RESPONSE"
    exit 1
fi

echo ""
echo "✅ Stream Token Authentication deployed successfully!"
echo ""
echo "⚠️  IMPORTANT: Frontend needs to be updated to use token authentication"
echo "   - Update VideoPlayer components to use streamTokenService"
echo "   - Pass token in HLS URL query parameter: ?token=xxx"
echo ""
