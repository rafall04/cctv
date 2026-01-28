#!/bin/bash
# Deploy Playback Seeking Fix
# Ubuntu 20.04 - Run as root

set -e  # Exit on error

echo "=========================================="
echo "Deploying Playback Seeking Fix"
echo "=========================================="
echo ""

# 1. Pull latest changes
echo "📥 Pulling latest changes from GitHub..."
cd /var/www/rafnet-cctv
git pull origin main
echo "✓ Git pull completed"
echo ""

# 2. Backup current nginx config
echo "💾 Backing up current nginx config..."
BACKUP_FILE="/etc/nginx/sites-available/cctv.backup.$(date +%Y%m%d_%H%M%S)"
cp /etc/nginx/sites-available/cctv "$BACKUP_FILE"
echo "✓ Backup saved to: $BACKUP_FILE"
echo ""

# 3. Copy new nginx config
echo "📋 Copying new nginx config..."
cp deployment/nginx.conf /etc/nginx/sites-available/cctv
echo "✓ Nginx config copied"
echo ""

# 4. Test nginx config
echo "🔍 Testing nginx configuration..."
nginx -t
if [ $? -ne 0 ]; then
    echo "❌ Nginx config test failed!"
    echo "Restoring backup..."
    cp "$BACKUP_FILE" /etc/nginx/sites-available/cctv
    exit 1
fi
echo "✓ Nginx config test passed"
echo ""

# 5. Show diff of what changed
echo "📝 Changes in nginx config:"
echo "-------------------------------------------"
diff -u "$BACKUP_FILE" /etc/nginx/sites-available/cctv || true
echo "-------------------------------------------"
echo ""

# 6. Reload nginx
echo "🔄 Reloading nginx..."
systemctl reload nginx
if [ $? -ne 0 ]; then
    echo "❌ Nginx reload failed!"
    echo "Restoring backup..."
    cp "$BACKUP_FILE" /etc/nginx/sites-available/cctv
    systemctl reload nginx
    exit 1
fi
echo "✓ Nginx reloaded successfully"
echo ""

# 7. Verify nginx is running
echo "✅ Verifying nginx status..."
systemctl status nginx --no-pager | head -n 5
echo ""

# 8. Build frontend
echo "🏗️  Building frontend..."
cd /var/www/rafnet-cctv/frontend
npm run build
echo "✓ Frontend build completed"
echo ""

# 9. Test backend endpoint
echo "🧪 Testing backend recording endpoint..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/recordings/1/segments)
if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "404" ]; then
    echo "✓ Backend responding (HTTP $RESPONSE)"
else
    echo "⚠️  Backend returned HTTP $RESPONSE (may need restart)"
fi
echo ""

# 10. Show nginx config for /api/recordings/
echo "📄 Current nginx config for /api/recordings/:"
echo "-------------------------------------------"
grep -A 20 "location /api/recordings/" /etc/nginx/sites-available/cctv | head -n 21
echo "-------------------------------------------"
echo ""

echo "=========================================="
echo "✅ Deployment completed successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Test playback seeking in browser"
echo "2. Check browser console for [Video] logs"
echo "3. Monitor nginx logs: tail -f /var/log/nginx/rafnet-cctv-frontend.error.log"
echo ""
echo "If issues persist, check:"
echo "- Backend logs: pm2 logs rafnet-cctv-backend"
echo "- Nginx error logs: tail -f /var/log/nginx/error.log"
echo ""
