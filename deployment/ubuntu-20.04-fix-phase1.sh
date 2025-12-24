#!/bin/bash

# =================================================================
# RAF NET CCTV - Ubuntu 20.04 Compatibility Fix - PHASE 1
# =================================================================
# 
# PHASE 1: System Dependencies & Build Environment
# 
# This script fixes the fundamental system-level issues that cause
# deployment failures on Ubuntu 20.04:
# 
# 1. Ensures correct Node.js version (18+ LTS)
# 2. Installs all required build tools for native dependencies
# 3. Fixes Python symlinks for node-gyp
# 4. Validates system requirements
# 5. Pre-compiles native modules
# 
# MUST BE RUN AS ROOT
# =================================================================

set -e

echo "🚀 RAF NET CCTV - Ubuntu 20.04 Fix Phase 1"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Phase 1: System Dependencies & Build Environment"
echo ""

# Check if running as root (REQUIRED)
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script MUST be run as root"
   echo "   Run with: sudo bash deployment/ubuntu-20.04-fix-phase1.sh"
   exit 1
fi

# 1. Update system packages
echo "📦 Step 1: Updating system packages..."
apt update
apt upgrade -y

# 2. Install essential build tools for Ubuntu 20.04
echo "🔨 Step 2: Installing build tools and dependencies..."
apt install -y \
    curl \
    wget \
    git \
    build-essential \
    python3 \
    python3-pip \
    python3-dev \
    python-is-python3 \
    pkg-config \
    libssl-dev \
    libffi-dev \
    sqlite3 \
    nginx \
    certbot \
    python3-certbot-nginx \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

# 3. Fix Python symlinks for node-gyp (Ubuntu 20.04 specific)
echo "🐍 Step 3: Fixing Python environment for node-gyp..."
if ! command -v python &> /dev/null; then
    ln -sf /usr/bin/python3 /usr/bin/python
fi

# Verify Python setup
python --version
python3 --version

# 4. Install Node.js 18 LTS (Ubuntu 20.04 compatible)
echo "🟢 Step 4: Installing Node.js 18 LTS..."
# Remove any existing Node.js
apt remove -y nodejs npm || true

# Add NodeSource repository for Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Verify Node.js installation
echo "📊 Node.js version check:"
node --version
npm --version

# Check if Node.js version is 18+
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Need 18+"
    exit 1
fi

# 5. Install and configure npm global packages
echo "📦 Step 5: Installing global npm packages..."
npm install -g pm2@latest
npm install -g node-gyp@latest

# 6. Configure npm for native compilation
echo "🔧 Step 6: Configuring npm for native compilation..."
npm config set python python3
npm config set node_gyp $(which node-gyp)

# 7. Test native compilation capability
echo "🧪 Step 7: Testing native compilation..."
mkdir -p /tmp/test-native-build
cd /tmp/test-native-build

# Create a minimal package.json for testing
cat > package.json << EOF
{
  "name": "test-native-build",
  "version": "1.0.0",
  "dependencies": {
    "better-sqlite3": "^11.7.0"
  }
}
EOF

echo "   Testing better-sqlite3 compilation..."
if npm install --silent; then
    echo "   ✅ Native compilation test successful"
    rm -rf /tmp/test-native-build
else
    echo "   ❌ Native compilation test failed"
    echo "   This indicates build environment issues"
    exit 1
fi

# 8. System resource check
echo "💾 Step 8: System resource check..."
echo "   Memory: $(free -h | grep '^Mem:' | awk '{print $2}')"
echo "   Disk: $(df -h / | tail -1 | awk '{print $4}') available"
echo "   CPU: $(nproc) cores"

# Check minimum requirements
MEMORY_GB=$(free -g | grep '^Mem:' | awk '{print $2}')
if [ "$MEMORY_GB" -lt 1 ]; then
    echo "   ⚠️  Warning: Less than 1GB RAM detected"
    echo "      Consider adding swap space for compilation"
fi

# 9. Create project directory structure (as root)
echo "📁 Step 9: Preparing project directory..."
mkdir -p /opt/cctv
chown -R root:root /opt/cctv
chmod -R 755 /opt/cctv

# 10. Firewall configuration
echo "🔥 Step 10: Configuring firewall..."
if command -v ufw &> /dev/null; then
    echo "   Configuring UFW firewall..."
    ufw --force enable
    ufw allow 22/tcp    # SSH
    ufw allow 80/tcp    # HTTP
    ufw allow 443/tcp   # HTTPS
    ufw allow 3000/tcp  # Backend API
    ufw allow 8888/tcp  # MediaMTX HLS
    ufw allow 8889/tcp  # MediaMTX WebRTC
    ufw allow 9997/tcp  # MediaMTX API
    echo "   ✅ Firewall configured"
else
    echo "   No UFW firewall detected"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Phase 1 Complete: System Dependencies & Build Environment"
echo ""
echo "📋 What was fixed:"
echo "   ✓ Ubuntu 20.04 system packages updated"
echo "   ✓ Build tools installed (gcc, python3, node-gyp)"
echo "   ✓ Node.js 18 LTS installed and verified"
echo "   ✓ PM2 process manager installed"
echo "   ✓ Native compilation tested successfully"
echo "   ✓ Project directory prepared at /opt/cctv"
echo "   ✓ Firewall configured"
echo ""
echo "🚀 Ready for Phase 2: Backend Dependencies & Database Setup"
echo "   Run: bash deployment/ubuntu-20.04-fix-phase2.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"