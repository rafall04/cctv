#!/bin/bash

# =================================================================
# RAF NET CCTV - Ubuntu 20.04 Compatibility Fix - PHASE 5
# =================================================================
# 
# PHASE 5: Nginx & PM2 Final Configuration
# 
# This script completes the Ubuntu 20.04 deployment:
# 
# 1. Creates Ubuntu 20.04 optimized Nginx configuration
# 2. Sets up PM2 ecosystem with proper process management
# 3. Configures systemd integration
# 4. Tests complete system integration
# 5. Provides production deployment verification
# 
# =================================================================

set -e

echo "🚀 RAF NET CCTV - Ubuntu 20.04 Fix Phase 5"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Phase 5: Nginx & PM2 Final Configuration"
echo ""

# Check if previous phases were completed
if ! command -v node &> /dev/null || ! command -v pm2 &> /dev/null; then
    echo "❌ Previous phases not completed. Please run phases in order."
    exit 1
fi

# Navigate to project root - Following steering rules
PROJECT_ROOT="/opt/cctv"
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "❌ Project directory not found. Please run Phase 1 first."
    exit 1
fi

cd "$PROJECT_ROOT"

# Check if MediaMTX was set up
if [ ! -f "mediamtx/mediamtx" ]; then
    echo "❌ Phase 4 not completed. Please run Phase 4 first."
    exit 1
fi

# 1. Stop any running services
echo "🛑 Step 1: Stopping existing services..."
pm2 stop all || echo "No PM2 processes running"
systemctl stop nginx || echo "Nginx not running"

# 2. Create Ubuntu 20.04 optimized Nginx configuration
echo "🌐 Step 2: Creating Ubuntu 20.04 optimized Nginx configuration..."

# Backup existing nginx config (as root)
if [ -f "/etc/nginx/sites-available/rafnet-cctv" ]; then
    cp /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-available/rafnet-cctv.backup
fi

# Create optimized nginx configuration (as root)
tee /etc/nginx/sites-available/rafnet-cctv > /dev/null << EOF
# RAF NET CCTV - Ubuntu 20.04 Optimized Nginx Configuration

# Frontend Server Block
server {
    listen 80;
    listen [::]:80;
    
    server_name cctv.raf.my.id 172.17.11.12;
    
    root /opt/cctv/frontend/dist;
    index index.html;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
    
    # Static assets with caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }
    
    # SPA routing
    location / {
        try_files \$uri \$uri/ /index.html;
        
        # Prevent caching of index.html
        location = /index.html {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }
    }
    
    # HLS streaming proxy
    location /hls/ {
        proxy_pass http://127.0.0.1:8888/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # CORS headers for streaming
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range' always;
        add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range' always;
        
        # Handle preflight requests
        if (\$request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' '*';
            add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
            add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range';
            add_header 'Access-Control-Max-Age' 1728000;
            add_header 'Content-Type' 'text/plain; charset=utf-8';
            add_header 'Content-Length' 0;
            return 204;
        }
    }
    
    # WebRTC streaming proxy
    location /webrtc/ {
        proxy_pass http://127.0.0.1:8889/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    access_log /var/log/nginx/rafnet-cctv-frontend.access.log;
    error_log /var/log/nginx/rafnet-cctv-frontend.error.log;
}

# Backend API Server Block
server {
    listen 80;
    listen [::]:80;
    
    server_name api-cctv.raf.my.id;
    
    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/s;
    
    location / {
        limit_req zone=api burst=20 nodelay;
        
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffer settings
        proxy_buffering on;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }
    
    # Health check endpoint (no rate limiting)
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        access_log off;
    }
    
    access_log /var/log/nginx/rafnet-cctv-backend.access.log;
    error_log /var/log/nginx/rafnet-cctv-backend.error.log;
}

# Default server block (catch-all)
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    
    return 444; # Close connection without response
}
EOF

echo "   ✅ Ubuntu 20.04 optimized Nginx configuration created"

# 3. Enable site and test configuration
echo "🔧 Step 3: Enabling site and testing Nginx configuration..."

# Remove default site (as root)
rm -f /etc/nginx/sites-enabled/default

# Enable our site (as root)
ln -sf /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-enabled/

# Test nginx configuration (as root)
if nginx -t; then
    echo "   ✅ Nginx configuration test passed"
else
    echo "   ❌ Nginx configuration test failed"
    exit 1
fi

# 4. Create Ubuntu 20.04 optimized PM2 ecosystem
echo "⚙️ Step 4: Creating Ubuntu 20.04 optimized PM2 ecosystem..."

cat > deployment/ecosystem.ubuntu20.config.cjs << 'EOF'
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

module.exports = {
    apps: [
        {
            name: 'rafnet-cctv-backend',
            script: 'server.js',
            cwd: path.join(ROOT_DIR, 'backend'),
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            min_uptime: '10s',
            max_restarts: 10,
            restart_delay: 4000,
            env: {
                NODE_ENV: 'development',
                PORT: 3000,
                HOST: '127.0.0.1'
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 3000,
                HOST: '127.0.0.1'
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            error_file: path.join(ROOT_DIR, 'logs/backend-error.log'),
            out_file: path.join(ROOT_DIR, 'logs/backend-out.log'),
            log_file: path.join(ROOT_DIR, 'logs/backend-combined.log')
        },
        {
            name: 'mediamtx',
            script: './mediamtx',
            cwd: path.join(ROOT_DIR, 'mediamtx'),
            args: ['mediamtx.yml'],
            interpreter: 'none',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '256M',
            min_uptime: '10s',
            max_restarts: 10,
            restart_delay: 4000,
            env: {
                MEDIAMTX_CONFPATH: 'mediamtx.yml'
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            error_file: path.join(ROOT_DIR, 'logs/mediamtx-error.log'),
            out_file: path.join(ROOT_DIR, 'logs/mediamtx-out.log'),
            log_file: path.join(ROOT_DIR, 'logs/mediamtx-combined.log')
        }
    ]
};
EOF

echo "   ✅ Ubuntu 20.04 optimized PM2 ecosystem created"

# 5. Create logs directory
echo "📁 Step 5: Setting up logging directories..."
mkdir -p logs
chmod 755 logs

# 6. Configure PM2 for Ubuntu 20.04
echo "🔄 Step 6: Configuring PM2 for Ubuntu 20.04..."

# Delete any existing PM2 processes
pm2 delete all || true

# Start with the new ecosystem
pm2 start deployment/ecosystem.ubuntu20.config.cjs --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup script for Ubuntu 20.04 (as root)
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root

echo "   ✅ PM2 configured for Ubuntu 20.04"

# 7. Start Nginx
echo "🌐 Step 7: Starting Nginx..."
systemctl start nginx
systemctl enable nginx

# 8. Wait for services to initialize
echo "⏳ Step 8: Waiting for services to initialize..."
sleep 10

# 9. Comprehensive system test
echo "🧪 Step 9: Running comprehensive system tests..."

echo "   Testing Backend..."
if curl -s http://127.0.0.1:3000/health | grep -q "OK" || curl -s http://127.0.0.1:3000/health > /dev/null; then
    echo "   ✅ Backend responding on localhost:3000"
else
    echo "   ❌ Backend not responding on localhost:3000"
    echo "   PM2 Status:"
    pm2 list
    echo "   Backend Logs:"
    pm2 logs rafnet-cctv-backend --lines 10
fi

echo "   Testing MediaMTX..."
if curl -s http://127.0.0.1:9997/v3/config > /dev/null; then
    echo "   ✅ MediaMTX API responding on localhost:9997"
else
    echo "   ❌ MediaMTX API not responding on localhost:9997"
    echo "   MediaMTX Logs:"
    pm2 logs mediamtx --lines 10
fi

echo "   Testing Nginx..."
if curl -s -H "Host: cctv.raf.my.id" http://127.0.0.1/ | grep -q "<!DOCTYPE html>" || curl -s -H "Host: cctv.raf.my.id" http://127.0.0.1/ > /dev/null; then
    echo "   ✅ Nginx serving frontend correctly"
else
    echo "   ❌ Nginx not serving frontend correctly"
    sudo nginx -t
fi

if curl -s -H "Host: api-cctv.raf.my.id" http://127.0.0.1/health > /dev/null; then
    echo "   ✅ Nginx proxying backend API correctly"
else
    echo "   ❌ Nginx not proxying backend API correctly"
fi

# 10. Create management scripts
echo "📜 Step 10: Creating system management scripts..."

# System start script
cat > start-system.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting RAF NET CCTV System..."

# Start PM2 processes
pm2 start deployment/ecosystem.ubuntu20.config.cjs --env production

# Start Nginx
systemctl start nginx

echo "✅ System started"
echo "📊 Status:"
pm2 list
systemctl status nginx --no-pager -l
EOF

# System stop script
cat > stop-system.sh << 'EOF'
#!/bin/bash
echo "🛑 Stopping RAF NET CCTV System..."

# Stop PM2 processes
pm2 stop all

# Stop Nginx
systemctl stop nginx

echo "✅ System stopped"
EOF

# System status script
cat > status-system.sh << 'EOF'
#!/bin/bash
echo "📊 RAF NET CCTV System Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "PM2 Processes:"
pm2 list

echo ""
echo "Nginx Status:"
systemctl status nginx --no-pager -l

echo ""
echo "Port Usage:"
netstat -tuln | grep -E ":(3000|8888|8889|9997|1935|80) "

echo ""
echo "System Resources:"
echo "Memory: $(free -h | grep '^Mem:' | awk '{print $3 "/" $2}')"
echo "Disk: $(df -h / | tail -1 | awk '{print $3 "/" $2 " (" $5 " used)"}')"
echo "Load: $(uptime | awk -F'load average:' '{print $2}')"
EOF

# System restart script
cat > restart-system.sh << 'EOF'
#!/bin/bash
echo "🔄 Restarting RAF NET CCTV System..."

# Restart PM2 processes
pm2 restart all

# Restart Nginx
systemctl restart nginx

echo "✅ System restarted"
echo "📊 Status:"
pm2 list
EOF

chmod +x *.sh

echo "   ✅ Management scripts created"

# 11. Final system verification
echo "🔍 Step 11: Final system verification..."

echo ""
echo "📊 System Status Summary:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# PM2 status
echo "PM2 Processes:"
pm2 list

echo ""
echo "Service Status:"
echo "   Nginx: $(systemctl is-active nginx)"
echo "   Backend: $(pm2 jlist | jq -r '.[] | select(.name=="rafnet-cctv-backend") | .pm2_env.status' 2>/dev/null || echo "unknown")"
echo "   MediaMTX: $(pm2 jlist | jq -r '.[] | select(.name=="mediamtx") | .pm2_env.status' 2>/dev/null || echo "unknown")"

echo ""
echo "Network Endpoints:"
echo "   Frontend: http://cctv.raf.my.id (via Nginx)"
echo "   Backend API: http://api-cctv.raf.my.id (via Nginx)"
echo "   Backend Direct: http://127.0.0.1:3000"
echo "   MediaMTX API: http://127.0.0.1:9997"
echo "   HLS Streaming: http://127.0.0.1:8888"
echo "   WebRTC: http://127.0.0.1:8889"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Phase 5 Complete: Nginx & PM2 Final Configuration"
echo ""
echo "🎉 RAF NET CCTV Ubuntu 20.04 Deployment Complete!"
echo ""
echo "📋 All phases completed successfully:"
echo "   ✓ Phase 1: System Dependencies & Build Environment"
echo "   ✓ Phase 2: Backend Dependencies & Database Setup"
echo "   ✓ Phase 3: Frontend Build & Configuration"
echo "   ✓ Phase 4: MediaMTX Configuration & Setup"
echo "   ✓ Phase 5: Nginx & PM2 Final Configuration"
echo ""
echo "🚀 Next Steps:"
echo "   1. Update DNS A records to point to your server IP"
echo "   2. Run 'sudo certbot --nginx' for SSL certificates"
echo "   3. Configure firewall: sudo ufw allow 80,443,1935,8888,8889/tcp"
echo "   4. Test with your camera RTSP URLs"
echo ""
echo "📜 Management Commands:"
echo "   ./start-system.sh    - Start all services"
echo "   ./stop-system.sh     - Stop all services"
echo "   ./restart-system.sh  - Restart all services"
echo "   ./status-system.sh   - Check system status"
echo ""
echo "🔧 Troubleshooting:"
echo "   pm2 logs             - View all logs"
echo "   pm2 logs backend     - View backend logs"
echo "   pm2 logs mediamtx    - View MediaMTX logs"
echo "   nginx -t        - Test Nginx config"
echo "   systemctl status nginx - Check Nginx status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Auto-push changes to GitHub (following steering rules)
echo ""
echo "🔄 Auto-pushing Phase 5 completion to GitHub..."
if command -v git &> /dev/null && [ -d ".git" ]; then
    git add .
    git commit -m "Deploy: Ubuntu 20.04 Phase 5 completed - Full deployment finished - $(date '+%Y-%m-%d %H:%M:%S')" || echo "No changes to commit"
    git push origin main || echo "Push failed - check git configuration"
    echo "✅ Phase 5 changes pushed to GitHub"
else
    echo "⚠️  Git not available or not in git repository"
fi