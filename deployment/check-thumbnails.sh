#!/bin/bash
# Quick thumbnail diagnostic for production
# Run: bash deployment/check-thumbnails.sh

echo "🔍 Thumbnail Service Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. FFmpeg
echo -e "\n1. FFmpeg:"
if command -v ffmpeg &> /dev/null; then
    echo "   ✅ $(ffmpeg -version | head -1)"
else
    echo "   ❌ Not installed"
fi

# 2. MediaMTX
echo -e "\n2. MediaMTX:"
if curl -s http://localhost:9997/v3/config/global/get &> /dev/null; then
    echo "   ✅ Online"
else
    echo "   ❌ Offline"
fi

# 3. Thumbnail files
echo -e "\n3. Thumbnail files:"
ls -lh /var/www/rafnet-cctv/backend/data/thumbnails/*.jpg 2>/dev/null || echo "   No files"

# 4. Database check
echo -e "\n4. Database thumbnails:"
cd /var/www/rafnet-cctv/backend
node -e "
import { query } from './database/database.js';
const cams = query('SELECT id, name, thumbnail_path FROM cameras WHERE enabled = 1 LIMIT 3');
cams.forEach(c => console.log(\`   Camera \${c.id}: \${c.thumbnail_path || 'NULL'}\`));
"

# 5. Recent logs
echo -e "\n5. Recent logs:"
pm2 logs rafnet-cctv-backend --lines 20 --nostream | grep -i thumbnail || echo "   No thumbnail logs"

echo -e "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
