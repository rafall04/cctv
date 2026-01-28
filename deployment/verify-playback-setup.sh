#!/bin/bash
# Verify Playback Setup
# Ubuntu 20.04 - Run as root

echo "=========================================="
echo "Verifying Playback Setup"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check function
check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1"
        return 1
    fi
}

# 1. Check nginx config exists
echo "1. Checking nginx configuration..."
if [ -f /etc/nginx/sites-available/cctv ]; then
    check "Nginx config file exists"
else
    echo -e "${RED}✗${NC} Nginx config file NOT found"
    exit 1
fi
echo ""

# 2. Check if /api/recordings/ location exists
echo "2. Checking /api/recordings/ location block..."
if grep -q "location /api/recordings/" /etc/nginx/sites-available/cctv; then
    check "/api/recordings/ location block exists"
    
    # Check critical settings
    if grep -A 20 "location /api/recordings/" /etc/nginx/sites-available/cctv | grep -q "proxy_buffering off"; then
        check "proxy_buffering off is set"
    else
        echo -e "${RED}✗${NC} proxy_buffering off NOT found"
    fi
    
    if grep -A 20 "location /api/recordings/" /etc/nginx/sites-available/cctv | grep -q "proxy_set_header Range"; then
        check "Range header forwarding is set"
    else
        echo -e "${RED}✗${NC} Range header forwarding NOT found"
    fi
else
    echo -e "${RED}✗${NC} /api/recordings/ location block NOT found"
    echo ""
    echo "Available location blocks:"
    grep "location " /etc/nginx/sites-available/cctv
    exit 1
fi
echo ""

# 3. Check nginx syntax
echo "3. Testing nginx syntax..."
nginx -t 2>&1 | grep -q "syntax is ok"
check "Nginx syntax is valid"
echo ""

# 4. Check nginx is running
echo "4. Checking nginx status..."
systemctl is-active --quiet nginx
check "Nginx is running"
echo ""

# 5. Check backend is running
echo "5. Checking backend status..."
pm2 list | grep -q "rafnet-cctv-backend"
check "Backend process exists"

pm2 list | grep "rafnet-cctv-backend" | grep -q "online"
check "Backend is online"
echo ""

# 6. Test backend endpoint
echo "6. Testing backend recording endpoint..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/recordings/1/segments)
if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "404" ]; then
    check "Backend responding (HTTP $RESPONSE)"
else
    echo -e "${YELLOW}⚠${NC}  Backend returned HTTP $RESPONSE"
fi
echo ""

# 7. Test Range Request support
echo "7. Testing Range Request support..."
# Create a test file if recordings exist
RECORDING_DIR="/var/www/rafnet-cctv/recordings"
if [ -d "$RECORDING_DIR" ]; then
    # Find first MP4 file
    TEST_FILE=$(find "$RECORDING_DIR" -name "*.mp4" -type f | head -n 1)
    if [ -n "$TEST_FILE" ]; then
        FILENAME=$(basename "$TEST_FILE")
        CAMERA_DIR=$(basename $(dirname "$TEST_FILE"))
        CAMERA_ID=${CAMERA_DIR#camera}
        
        echo "Testing with: $CAMERA_DIR/$FILENAME"
        
        # Test Range Request
        RANGE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -H "Range: bytes=0-1023" "http://localhost:3000/api/recordings/$CAMERA_ID/stream/$FILENAME")
        if [ "$RANGE_RESPONSE" = "206" ]; then
            check "Range Request returns HTTP 206 Partial Content"
        else
            echo -e "${RED}✗${NC} Range Request returned HTTP $RANGE_RESPONSE (expected 206)"
        fi
    else
        echo -e "${YELLOW}⚠${NC}  No recording files found for testing"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Recording directory not found"
fi
echo ""

# 8. Check frontend build
echo "8. Checking frontend build..."
if [ -d /var/www/rafnet-cctv/frontend/dist ]; then
    check "Frontend dist directory exists"
    
    if [ -f /var/www/rafnet-cctv/frontend/dist/index.html ]; then
        check "Frontend index.html exists"
    else
        echo -e "${RED}✗${NC} Frontend index.html NOT found"
    fi
else
    echo -e "${RED}✗${NC} Frontend dist directory NOT found"
fi
echo ""

# 9. Show current nginx config for /api/recordings/
echo "9. Current nginx config for /api/recordings/:"
echo "-------------------------------------------"
grep -A 20 "location /api/recordings/" /etc/nginx/sites-available/cctv | head -n 21
echo "-------------------------------------------"
echo ""

# 10. Summary
echo "=========================================="
echo "Verification Summary"
echo "=========================================="
echo ""
echo "If all checks passed, playback seeking should work."
echo ""
echo "To test:"
echo "1. Open browser: http://cctv.raf.my.id/playback"
echo "2. Select a camera with recordings"
echo "3. Play a video and seek to different positions"
echo "4. Check browser console for [Video] logs"
echo ""
echo "Troubleshooting:"
echo "- Nginx logs: tail -f /var/log/nginx/rafnet-cctv-frontend.error.log"
echo "- Backend logs: pm2 logs rafnet-cctv-backend"
echo "- Test Range Request: curl -I -H 'Range: bytes=0-1023' http://localhost:3000/api/recordings/1/stream/test.mp4"
echo ""
