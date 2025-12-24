#!/bin/bash

# RAF NET CCTV - Ubuntu 20.04 Production Installer
# Domains: cctv.raf.my.id (Frontend), api-cctv.raf.my.id (Backend)
# IP: 172.17.11.12

set -e

echo "🚀 Starting RAF NET CCTV Production Installation..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Update System
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential nginx sqlite3 certbot python3-certbot-nginx

# 2. Install Node.js 20
echo "🟢 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install PM2
echo "🔄 Installing PM2..."
sudo npm install -g pm2

# 4. Setup Project Directory
echo "📁 Setting up project directory..."
sudo mkdir -p /var/www/rafnet-cctv
sudo chown -R $USER:$USER /var/www/rafnet-cctv
cd /var/www/rafnet-cctv

# 5. Clone/Copy Project Files
# (Assuming files are already uploaded or cloned to this directory)
# If cloning: git clone <repo_url> .

# 6. Install Backend Dependencies
echo "🛠 Setting up Backend..."
cd backend
npm install --production
mkdir -p data
# Copy production env
cp ../deployment/backend.env.prod .env
# Setup Database
npm run setup-db
cd ..

# 7. Install Frontend Dependencies & Build
echo "🏗 Setting up Frontend..."
cd frontend
npm install
# Copy production env
cp ../deployment/frontend.env.prod .env.production
npm run build
# Install a simple static server for PM2 visibility (optional but helpful for 'automatic' feel)
sudo npm install -g serve
cd ..

# 8. Install MediaMTX
echo "📹 Installing MediaMTX..."
MEDIAMTX_VERSION="v1.9.3"
wget https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz
mkdir -p mediamtx
tar -xf mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz -C mediamtx
rm mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz
# Copy production config
cp deployment/mediamtx.yml mediamtx/mediamtx.yml

# 9. Configure Nginx
echo "🌐 Configuring Nginx..."
sudo cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
sudo ln -sf /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 10. Start Services with PM2
echo "🚀 Starting Services..."
# Start everything (Backend, Frontend, MediaMTX) via ecosystem config
pm2 start deployment/ecosystem.config.cjs --env production

# Save PM2 state
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp /home/$USER

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Installation Completed Successfully!"
echo "🌍 Frontend: https://cctv.raf.my.id (Proxied via Nginx)"
echo "📡 Backend:  https://api-cctv.raf.my.id"
echo "📊 PM2 Status:"
pm2 list
echo ""
echo "⚠️  Next Steps:"
echo "1. Run 'sudo certbot --nginx' to enable SSL for both domains."
echo "2. Ensure ports 80, 443, 1935 (RTMP), 8888 (HLS), 8889 (WebRTC) are open in your firewall."
echo "3. Update your DNS A records to point to 172.17.11.12."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
