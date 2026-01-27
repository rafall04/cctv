#!/bin/bash
# Fix sw.js caching issue

echo "🔍 Analyzing sw.js caching issue..."

ssh root@172.17.11.12 << 'EOF'
cd /var/www/rafnet-cctv/frontend

echo ""
echo "1️⃣ Checking sw.js in public folder:"
head -5 public/sw.js

echo ""
echo "2️⃣ Checking sw.js in dist folder:"
head -5 dist/sw.js

echo ""
echo "3️⃣ Checking file permissions:"
ls -lh dist/sw.js

echo ""
echo "4️⃣ Checking Nginx cache:"
find /var/cache/nginx -name "*sw.js*" 2>/dev/null || echo "No Nginx cache found"

echo ""
echo "5️⃣ Testing direct file access:"
cat dist/sw.js | head -5

echo ""
echo "6️⃣ Clearing Nginx cache (if exists):"
rm -rf /var/cache/nginx/* 2>/dev/null || echo "No cache to clear"

echo ""
echo "7️⃣ Reloading Nginx:"
nginx -t && systemctl reload nginx

echo ""
echo "8️⃣ Testing via curl (bypassing cache):"
curl -s -H "Cache-Control: no-cache" -H "Pragma: no-cache" http://localhost:800/sw.js | head -5

echo ""
echo "9️⃣ Testing via public URL:"
curl -s -H "Cache-Control: no-cache" https://cctv.raf.my.id/sw.js | head -5

echo ""
echo "✅ Analysis complete!"
EOF
