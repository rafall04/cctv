#!/bin/bash
# Fix Video Seeking Issue - Deployment Script
# Ubuntu 20.04 Production Server

set -e

echo "=========================================="
echo "Video Seeking Fix - Deployment"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Error: This script must be run as root"
    exit 1
fi

# Navigate to project directory
cd /var/www/rafnet-cctv

echo "📥 Step 1: Pull latest changes from GitHub..."
git pull origin main
echo "✓ Code updated"
echo ""

echo "🔄 Step 2: Restart backend service..."
pm2 restart rafnet-cctv-backend
echo "✓ Backend restarted"
echo ""

echo "📝 Step 3: Update Nginx configuration..."
# Backup existing config
cp /etc/nginx/sites-available/cctv /etc/nginx/sites-available/cctv.backup.$(date +%Y%m%d_%H%M%S)
echo "✓ Config backed up"

# Copy new config
cp deployment/nginx.conf /etc/nginx/sites-available/cctv
echo "✓ New config copied"

# Test Nginx config
echo "Testing Nginx configuration..."
if nginx -t; then
    echo "✓ Nginx config valid"
    
    # Reload Nginx
    systemctl reload nginx
    echo "✓ Nginx reloaded"
else
    echo "❌ Nginx config test failed!"
    echo "Restoring backup..."
    cp /etc/nginx/sites-available/cctv.backup.$(date +%Y%m%d_%H%M%S) /etc/nginx/sites-available/cctv
    exit 1
fi
echo ""

echo "🧪 Step 4: Test Range Request support..."
# Wait for backend to be ready
sleep 3

# Get first camera ID
CAMERA_ID=$(sqlite3 /var/www/rafnet-cctv/data/cctv.db "SELECT id FROM cameras WHERE enable_recording = 1 LIMIT 1" 2>/dev/null || echo "")

if [ -n "$CAMERA_ID" ]; then
    # Get first segment filename
    SEGMENT=$(sqlite3 /var/www/rafnet-cctv/data/cctv.db "SELECT filename FROM recording_segments WHERE camera_id = $CAMERA_ID LIMIT 1" 2>/dev/null || echo "")
    
    if [ -n "$SEGMENT" ]; then
        echo "Testing with camera $CAMERA_ID, segment: $SEGMENT"
        
        # Test Range request
        RESPONSE=$(curl -s -I -H "Range: bytes=0-1023" "http://localhost:3000/api/recordings/$CAMERA_ID/stream/$SEGMENT" | head -n 1)
        
        if echo "$RESPONSE" | grep -q "206"; then
            echo "✓ Range Request working (206 Partial Content)"
        else
            echo "⚠️  Warning: Range Request may not be working properly"
            echo "   Response: $RESPONSE"
        fi
    else
        echo "ℹ️  No segments found for testing"
    fi
else
    echo "ℹ️  No cameras with recording enabled"
fi
echo ""

echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Test video seeking di browser:"
echo "   - Buka: http://cctv.raf.my.id/playback"
echo "   - Test short seek (1 min)"
echo "   - Test long seek (5+ min)"
echo ""
echo "2. Monitor logs:"
echo "   pm2 logs rafnet-cctv-backend"
echo ""
echo "3. (Optional) Re-process existing segments:"
echo "   cd /var/www/rafnet-cctv/backend"
echo "   node reprocess_segments.js"
echo ""
echo "Documentation: VIDEO_SEEKING_FIX.md"
echo "=========================================="
