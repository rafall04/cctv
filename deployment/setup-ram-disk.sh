#!/bin/bash
# RAF NET CCTV - RAM Disk Setup for Live HLS Streaming
# =====================================================
# Purpose: Setup /dev/shm for MediaMTX HLS output to eliminate disk I/O bottleneck
# Target: Ubuntu 20.04 Production Server

set -e

echo "🐧 RAF NET CCTV - RAM Disk Setup"
echo "=================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Error: This script must be run as root"
    exit 1
fi

# 1. Create MediaMTX HLS directory in RAM
echo "📁 Creating MediaMTX HLS directory in RAM..."
mkdir -p /dev/shm/mediamtx-live
chown root:root /dev/shm/mediamtx-live
chmod 755 /dev/shm/mediamtx-live
echo "✅ Created: /dev/shm/mediamtx-live"

# 2. Create Nginx cache directory in RAM
echo "📁 Creating Nginx cache directory in RAM..."
mkdir -p /dev/shm/nginx-cache
chown www-data:www-data /dev/shm/nginx-cache
chmod 755 /dev/shm/nginx-cache
echo "✅ Created: /dev/shm/nginx-cache"

# 3. Verify /dev/shm size
echo ""
echo "💾 RAM Disk Information:"
df -h /dev/shm | tail -1

# 4. Setup cleanup cron job (safety net)
echo ""
echo "🧹 Setting up automatic cleanup cron job..."

# Create cleanup script
cat > /usr/local/bin/cleanup-ram-hls.sh << 'EOF'
#!/bin/bash
# Cleanup old HLS segments in RAM (safety net if MediaMTX crashes)
# Delete .ts and .m3u8 files older than 10 minutes

find /dev/shm/mediamtx-live -type f \( -name "*.ts" -o -name "*.m3u8" \) -mmin +10 -delete 2>/dev/null || true
find /dev/shm/nginx-cache -type f -mmin +10 -delete 2>/dev/null || true
EOF

chmod +x /usr/local/bin/cleanup-ram-hls.sh

# Add to crontab (run every 5 minutes)
CRON_JOB="*/5 * * * * /usr/local/bin/cleanup-ram-hls.sh"
(crontab -l 2>/dev/null | grep -v "cleanup-ram-hls.sh"; echo "$CRON_JOB") | crontab -

echo "✅ Cleanup cron job installed (runs every 5 minutes)"

# 5. Test write permissions
echo ""
echo "🧪 Testing write permissions..."
touch /dev/shm/mediamtx-live/test.txt && rm /dev/shm/mediamtx-live/test.txt
echo "✅ Write test successful"

echo ""
echo "✅ RAM Disk setup completed successfully!"
echo ""
echo "📊 Summary:"
echo "  - MediaMTX HLS path: /dev/shm/mediamtx-live"
echo "  - Nginx cache path: /dev/shm/nginx-cache"
echo "  - Cleanup cron: Every 5 minutes (removes files >10 min old)"
echo ""
echo "⚠️  IMPORTANT:"
echo "  - /dev/shm is cleared on reboot - this script must run on startup"
echo "  - Add to /etc/rc.local or systemd service for persistence"
echo ""
