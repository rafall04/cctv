#!/bin/bash

# Fix Nginx API Routing
# Problem: /api/* requests were being forwarded to index.html instead of backend
# Solution: Add /api/ location block to frontend server to proxy to backend

echo "🔧 RAF NET CCTV - Fix Nginx API Routing"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Please run as root${NC}"
    exit 1
fi

# Navigate to project directory
cd /var/www/rafnet-cctv || exit 1

echo "📍 Current directory: $(pwd)"
echo ""

# Step 1: Backup current Nginx config
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Backup Current Config"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

NGINX_CONF="/etc/nginx/sites-available/cctv"
BACKUP_FILE="/etc/nginx/sites-available/cctv.backup.$(date +%Y%m%d_%H%M%S)"

if [ -f "$NGINX_CONF" ]; then
    cp "$NGINX_CONF" "$BACKUP_FILE"
    echo -e "${GREEN}✅ Backup created: $BACKUP_FILE${NC}"
else
    echo -e "${YELLOW}⚠️  Nginx config not found at $NGINX_CONF${NC}"
    echo "   Will create new config"
fi

echo ""

# Step 2: Copy new Nginx config
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Update Nginx Config"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "deployment/nginx.conf" ]; then
    cp deployment/nginx.conf "$NGINX_CONF"
    echo -e "${GREEN}✅ Nginx config updated${NC}"
else
    echo -e "${RED}❌ deployment/nginx.conf not found${NC}"
    exit 1
fi

echo ""

# Step 3: Test Nginx config
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3: Test Nginx Config"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

nginx -t

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Nginx config test passed${NC}"
else
    echo -e "${RED}❌ Nginx config test failed${NC}"
    echo ""
    echo "Restoring backup..."
    if [ -f "$BACKUP_FILE" ]; then
        cp "$BACKUP_FILE" "$NGINX_CONF"
        echo -e "${GREEN}✅ Backup restored${NC}"
    fi
    exit 1
fi

echo ""

# Step 4: Reload Nginx
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4: Reload Nginx"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

systemctl reload nginx

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Nginx reloaded successfully${NC}"
else
    echo -e "${RED}❌ Nginx reload failed${NC}"
    exit 1
fi

echo ""

# Step 5: Test API endpoint
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 5: Test API Endpoint"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "⏳ Waiting for Nginx to be ready..."
sleep 2

echo ""
echo "🧪 Testing /api/monetag/config endpoint..."
echo ""

# Test from localhost
RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:800/api/monetag/config)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Response Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ API endpoint working!${NC}"
    echo ""
    echo "📄 Response:"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
elif [ "$HTTP_CODE" = "404" ]; then
    echo -e "${RED}❌ Still getting 404 - API endpoint not found${NC}"
    echo ""
    echo "Possible causes:"
    echo "1. Backend not running"
    echo "2. Backend route not registered"
    echo "3. Nginx proxy not working"
    echo ""
    echo "Check backend logs:"
    echo "  pm2 logs rafnet-cctv-backend --lines 50"
else
    echo -e "${YELLOW}⚠️  Unexpected response code: $HTTP_CODE${NC}"
    echo ""
    echo "Response body:"
    echo "$BODY"
fi

echo ""

# Step 6: Test from external domain
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 6: Test from External Domain"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "🧪 Testing https://cctv.raf.my.id/api/monetag/config..."
echo ""

EXTERNAL_RESPONSE=$(curl -s -w "\n%{http_code}" https://cctv.raf.my.id/api/monetag/config 2>/dev/null)
EXTERNAL_HTTP_CODE=$(echo "$EXTERNAL_RESPONSE" | tail -n1)
EXTERNAL_BODY=$(echo "$EXTERNAL_RESPONSE" | head -n-1)

echo "Response Code: $EXTERNAL_HTTP_CODE"
echo ""

if [ "$EXTERNAL_HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ External API endpoint working!${NC}"
    echo ""
    echo "📄 Response:"
    echo "$EXTERNAL_BODY" | python3 -m json.tool 2>/dev/null || echo "$EXTERNAL_BODY"
else
    echo -e "${YELLOW}⚠️  External test: HTTP $EXTERNAL_HTTP_CODE${NC}"
    echo ""
    echo "Note: This might be expected if SSL/domain not configured"
    echo "      The important test is localhost (Step 5)"
fi

echo ""

# Final summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Nginx API Routing Fix Completed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Changes made:"
echo "  ✅ Added /api/ location block to frontend server"
echo "  ✅ Added /hls/ location block to frontend server"
echo "  ✅ Nginx config reloaded"
echo ""
echo "What this fixes:"
echo "  • /api/* requests now proxy to backend (port 3000)"
echo "  • /hls/* requests now proxy to backend for session tracking"
echo "  • Frontend can call API from same domain (no CORS issues)"
echo ""
echo "Next steps:"
echo "  1. Test Monetag config: https://cctv.raf.my.id/api/monetag/config"
echo "  2. Configure Zone IDs in admin panel"
echo "  3. Verify ads appear on website"
echo ""
