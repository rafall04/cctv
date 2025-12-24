#!/bin/bash

# =================================================================
# RAF NET CCTV - Ubuntu 20.04 Compatibility Fix - PHASE 4
# =================================================================
# 
# PHASE 4: MediaMTX Configuration & Setup
# 
# This script fixes MediaMTX-specific issues:
# 
# 1. Downloads correct MediaMTX version for Ubuntu 20.04
# 2. Creates Ubuntu 20.04 compatible configuration
# 3. Fixes time format issues (1d -> 24h)
# 4. Sets up proper permissions and directories
# 5. Tests MediaMTX functionality
# 
# =================================================================

set -e

echo "🚀 RAF NET CCTV - Ubuntu 20.04 Fix Phase 4"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Phase 4: MediaMTX Configuration & Setup"
echo ""

# Check if previous phases were completed
if ! command -v node &> /dev/null || ! command -v pm2 &> /dev/null; then
    echo "❌ Previous phases not completed. Please run phases in order."
    exit 1
fi

# Navigate to project root - Following existing structure
PROJECT_ROOT="/var/www/rafnet-cctv"
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "❌ Project directory not found. Please run Phase 1 first."
    exit 1
fi

cd "$PROJECT_ROOT"

# Check if frontend was built
if [ ! -d "frontend/dist" ]; then
    echo "❌ Phase 3 not completed. Please run Phase 3 first."
    exit 1
fi

# 1. Clean any existing MediaMTX installation
echo "🧹 Step 1: Cleaning existing MediaMTX installation..."
if [ -d "mediamtx" ]; then
    echo "   Removing old MediaMTX directory..."
    rm -rf mediamtx
fi

# Remove any downloaded archives
rm -f mediamtx_*.tar.gz

# 2. Download MediaMTX for Ubuntu 20.04
echo "📥 Step 2: Downloading MediaMTX for Ubuntu 20.04..."

# Use a stable version that's known to work with Ubuntu 20.04
MEDIAMTX_VERSION="v1.8.5"  # More stable than v1.9.3 for Ubuntu 20.04
MEDIAMTX_ARCH="linux_amd64"
MEDIAMTX_FILENAME="mediamtx_${MEDIAMTX_VERSION}_${MEDIAMTX_ARCH}.tar.gz"
MEDIAMTX_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${MEDIAMTX_FILENAME}"

echo "   Downloading: $MEDIAMTX_URL"
if wget -q --show-progress "$MEDIAMTX_URL"; then
    echo "   ✅ Download successful"
else
    echo "   ❌ Download failed"
    exit 1
fi

# 3. Extract and setup MediaMTX
echo "📦 Step 3: Extracting and setting up MediaMTX..."
mkdir -p mediamtx
tar -xf "$MEDIAMTX_FILENAME" -C mediamtx

# Verify extraction
if [ ! -f "mediamtx/mediamtx" ]; then
    echo "   ❌ MediaMTX binary not found after extraction"
    exit 1
fi

# Make binary executable
chmod +x mediamtx/mediamtx

# Clean up archive
rm -f "$MEDIAMTX_FILENAME"

echo "   ✅ MediaMTX extracted and configured"

# 4. Create Ubuntu 20.04 compatible configuration
echo "⚙️ Step 4: Creating Ubuntu 20.04 compatible MediaMTX configuration..."

cat > mediamtx/mediamtx.yml << 'EOF'
# MediaMTX Configuration for RAF NET CCTV - Ubuntu 20.04 Compatible
# Version: Optimized for MediaMTX v1.8.5 on Ubuntu 20.04

# Logging
logLevel: info
logDestinations: [stdout]

# API settings - bind to localhost only for security
api: yes
apiAddress: 127.0.0.1:9997

# RTSP settings
rtsp: yes
rtspAddress: :8554
protocols: [multicast, tcp]
encryption: "no"
rtspAddress: :8554

# HLS settings - optimized for Ubuntu 20.04
hls: yes
hlsAddress: :8888
hlsEncryption: no
hlsAlwaysRemux: no
hlsVariant: mpegts
hlsSegmentCount: 3
hlsSegmentDuration: 1s
hlsPartDuration: 200ms
hlsSegmentMaxSize: 50M

# WebRTC settings
webrtc: yes
webrtcAddress: :8889
webrtcLocalUDPAddress: :8189
webrtcIPsFromInterfaces: yes

# RTMP settings (for camera input)
rtmp: yes
rtmpAddress: :1935
rtmpEncryption: "no"

# SRT settings (disabled for Ubuntu 20.04 compatibility)
srt: no

# Recording settings
record: no

# Path defaults - Ubuntu 20.04 compatible time formats
pathDefaults:
  # Recording settings (using hours instead of days for compatibility)
  recordDeleteAfter: 24h
  
  # Authentication (disabled for public access)
  readUser: ""
  readPass: ""
  publishUser: ""
  publishPass: ""

# Paths configuration
paths:
  # Default path for all cameras - publisher mode (no sourceOnDemand)
  all:
    source: publisher
    
  # Health check path
  health:
    source: publisher
EOF

echo "   ✅ Ubuntu 20.04 compatible configuration created"

# 5. Test MediaMTX binary compatibility
echo "🧪 Step 5: Testing MediaMTX binary compatibility..."

# Test if binary runs on Ubuntu 20.04
if timeout 5s ./mediamtx/mediamtx --help > /dev/null 2>&1; then
    echo "   ✅ MediaMTX binary compatible with Ubuntu 20.04"
else
    echo "   ❌ MediaMTX binary not compatible with Ubuntu 20.04"
    echo "   Trying alternative version..."
    
    # Try older version
    rm -rf mediamtx
    MEDIAMTX_VERSION="v1.7.0"
    MEDIAMTX_FILENAME="mediamtx_${MEDIAMTX_VERSION}_${MEDIAMTX_ARCH}.tar.gz"
    MEDIAMTX_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${MEDIAMTX_FILENAME}"
    
    wget -q "$MEDIAMTX_URL"
    mkdir -p mediamtx
    tar -xf "$MEDIAMTX_FILENAME" -C mediamtx
    chmod +x mediamtx/mediamtx
    rm -f "$MEDIAMTX_FILENAME"
    
    # Copy config again
    cp mediamtx/mediamtx.yml mediamtx/mediamtx.yml.bak
    
    if timeout 5s ./mediamtx/mediamtx --help > /dev/null 2>&1; then
        echo "   ✅ Alternative MediaMTX version working"
    else
        echo "   ❌ MediaMTX compatibility issues persist"
        exit 1
    fi
fi

# 6. Create MediaMTX directories and set permissions
echo "📁 Step 6: Setting up MediaMTX directories and permissions..."

# Create necessary directories
mkdir -p mediamtx/logs
mkdir -p mediamtx/recordings

# Set proper permissions
chmod 755 mediamtx
chmod +x mediamtx/mediamtx
chmod 644 mediamtx/mediamtx.yml
chmod 755 mediamtx/logs
chmod 755 mediamtx/recordings

echo "   ✅ Directories and permissions configured"

# 7. Test MediaMTX configuration validity
echo "🔧 Step 7: Testing MediaMTX configuration validity..."

# Start MediaMTX briefly to test config
cd mediamtx
timeout 10s ./mediamtx mediamtx.yml &
MEDIAMTX_PID=$!

# Wait for startup
sleep 3

# Check if MediaMTX is running
if kill -0 $MEDIAMTX_PID 2>/dev/null; then
    echo "   ✅ MediaMTX started successfully with configuration"
    
    # Test API endpoint
    if curl -s http://127.0.0.1:9997/v3/config > /dev/null; then
        echo "   ✅ MediaMTX API responding"
    else
        echo "   ⚠️  MediaMTX API not responding (may be normal during startup)"
    fi
    
    # Stop test instance
    kill $MEDIAMTX_PID 2>/dev/null || true
    wait $MEDIAMTX_PID 2>/dev/null || true
else
    echo "   ❌ MediaMTX failed to start"
    exit 1
fi

cd ..

# 8. Create MediaMTX systemd service (as root)
echo "🔧 Step 8: Creating MediaMTX systemd service..."

tee /etc/systemd/system/mediamtx.service > /dev/null << EOF
[Unit]
Description=MediaMTX RTSP Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/var/www/rafnet-cctv/mediamtx
ExecStart=/var/www/rafnet-cctv/mediamtx/mediamtx mediamtx.yml
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "   ✅ MediaMTX systemd service created"

# 9. Test port availability
echo "🔌 Step 9: Testing port availability..."

REQUIRED_PORTS=(8554 8888 8889 1935 9997)
for port in "${REQUIRED_PORTS[@]}"; do
    if netstat -tuln | grep -q ":$port "; then
        echo "   ⚠️  Port $port is already in use"
        echo "      This may cause conflicts. Consider stopping other services."
    else
        echo "   ✅ Port $port available"
    fi
done

# 10. Create MediaMTX management scripts
echo "📜 Step 10: Creating MediaMTX management scripts..."

# Start script
cat > mediamtx/start.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
echo "Starting MediaMTX..."
./mediamtx mediamtx.yml
EOF

# Stop script  
cat > mediamtx/stop.sh << 'EOF'
#!/bin/bash
echo "Stopping MediaMTX..."
pkill -f "mediamtx mediamtx.yml" || echo "MediaMTX not running"
EOF

# Status script
cat > mediamtx/status.sh << 'EOF'
#!/bin/bash
if pgrep -f "mediamtx mediamtx.yml" > /dev/null; then
    echo "MediaMTX is running"
    echo "API: http://127.0.0.1:9997"
    echo "HLS: http://localhost:8888"
    echo "WebRTC: http://localhost:8889"
else
    echo "MediaMTX is not running"
fi
EOF

chmod +x mediamtx/*.sh

echo "   ✅ Management scripts created"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Phase 4 Complete: MediaMTX Configuration & Setup"
echo ""
echo "📋 What was fixed:"
echo "   ✓ MediaMTX v1.8.5 downloaded and configured for Ubuntu 20.04"
echo "   ✓ Ubuntu 20.04 compatible configuration created"
echo "   ✓ Time format issues fixed (24h instead of 1d)"
echo "   ✓ Binary compatibility verified"
echo "   ✓ Proper permissions and directories set"
echo "   ✓ Systemd service created"
echo "   ✓ Management scripts created"
echo ""
echo "📊 MediaMTX Configuration:"
echo "   🔌 API: http://127.0.0.1:9997"
echo "   📺 HLS: http://localhost:8888"
echo "   🌐 WebRTC: http://localhost:8889"
echo "   📡 RTMP: rtmp://localhost:1935"
echo "   📍 Location: $PROJECT_ROOT/mediamtx"
echo ""
echo "🚀 Ready for Phase 5: Nginx & PM2 Final Configuration"
echo "   Run: bash deployment/ubuntu-20.04-fix-phase5.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Note: Git auto-push disabled for server deployment
echo ""
echo "ℹ️  Git auto-push disabled on server"