#!/bin/bash
# ===================================
# MediaMTX Port Security Configuration
# ===================================
# This script blocks external access to MediaMTX ports
# while allowing localhost (backend) to access them
#
# Run as root: bash secure-mediamtx-ports.sh

set -e

echo "🔒 Securing MediaMTX Ports..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Error: This script must be run as root"
    exit 1
fi

# Check if ufw is installed
if ! command -v ufw &> /dev/null; then
    echo "📦 Installing ufw..."
    apt update
    apt install -y ufw
fi

# Reset UFW to default (optional - comment out if you have existing rules)
# ufw --force reset

# Set default policies
ufw default deny incoming
ufw default allow outgoing

echo ""
echo "🚫 Blocking MediaMTX ports from external access..."

# Block MediaMTX API (port 9997)
ufw deny 9997/tcp comment "Block MediaMTX API - localhost only"
echo "  ✓ Port 9997 (MediaMTX API) blocked"

# Block MediaMTX HLS (port 8888) - must go through Nginx
ufw deny 8888/tcp comment "Block MediaMTX HLS - use Nginx proxy"
echo "  ✓ Port 8888 (MediaMTX HLS) blocked"

# Block MediaMTX WebRTC (port 8889) - must go through Nginx
ufw deny 8889/tcp comment "Block MediaMTX WebRTC - use Nginx proxy"
echo "  ✓ Port 8889 (MediaMTX WebRTC) blocked"

# Block RTSP (port 8554) - only internal cameras should access
ufw deny 8554/tcp comment "Block RTSP - internal only"
echo "  ✓ Port 8554 (RTSP) blocked"

# Block RTMP (port 1935) - if not used
ufw deny 1935/tcp comment "Block RTMP - not used"
echo "  ✓ Port 1935 (RTMP) blocked"

echo ""
echo "✅ Allowing required ports..."

# Allow SSH (CRITICAL - don't lock yourself out!)
ufw allow 22/tcp comment "SSH access"
echo "  ✓ Port 22 (SSH) allowed"

# Allow Nginx HTTP (port 800 - aaPanel uses 80)
ufw allow 800/tcp comment "Nginx HTTP"
echo "  ✓ Port 800 (Nginx HTTP) allowed"

# Allow Nginx HTTPS (if configured)
ufw allow 443/tcp comment "Nginx HTTPS"
echo "  ✓ Port 443 (Nginx HTTPS) allowed"

# Allow aaPanel (if used)
ufw allow 80/tcp comment "aaPanel HTTP"
echo "  ✓ Port 80 (aaPanel) allowed"

echo ""
echo "🔥 Enabling firewall..."
ufw --force enable

echo ""
echo "📊 Current firewall status:"
ufw status numbered

echo ""
echo "✅ MediaMTX ports secured successfully!"
echo ""
echo "⚠️  IMPORTANT NOTES:"
echo "  1. MediaMTX API (9997) is now blocked from external access"
echo "  2. HLS/WebRTC must go through Nginx proxy"
echo "  3. Backend can still access MediaMTX via localhost"
echo "  4. If you need to access from specific IPs, use:"
echo "     ufw allow from <IP> to any port 9997"
echo ""
echo "🧪 Test your setup:"
echo "  - External: curl http://$(hostname -I | awk '{print $1}'):9997 (should fail)"
echo "  - Internal: curl http://localhost:9997/v3/config/global/get (should work)"
