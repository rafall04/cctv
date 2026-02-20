#!/bin/bash
# Download MediaMTX v1.9.0 for Linux AMD64

set -e

MEDIAMTX_VERSION="v1.9.0"
MEDIAMTX_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz"

echo "📥 Downloading MediaMTX ${MEDIAMTX_VERSION} for Linux..."

# Download to temp directory
cd /tmp
wget -O mediamtx.tar.gz "$MEDIAMTX_URL"

# Extract
echo "📦 Extracting..."
tar -xzf mediamtx.tar.gz

# Move binary to project
echo "📁 Installing to /var/www/rafnet-cctv/mediamtx/..."
mv mediamtx /var/www/rafnet-cctv/mediamtx/mediamtx
chmod +x /var/www/rafnet-cctv/mediamtx/mediamtx

# Cleanup
rm mediamtx.tar.gz
rm -f LICENSE README.md mediamtx.yml

echo "✅ MediaMTX Linux binary installed successfully!"
echo ""
echo "Next steps:"
echo "1. cd /var/www/rafnet-cctv"
echo "2. pm2 restart rafnet-mediamtx"
echo "3. pm2 logs rafnet-mediamtx"
