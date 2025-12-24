#!/bin/bash

# =================================================================
# RAF NET CCTV - Ubuntu 20.04 Post-Deployment Fix
# =================================================================
# 
# Fixes:
# 1. PM2 EPIPE Error - Kill and restart PM2 daemon
# 2. Backend binding - Allow access from 172.17.11.12:3000
# 3. MediaMTX restart
# 
# =================================================================

set -e

echo "🔧 RAF NET CCTV - Ubuntu 20.04 Post-Deployment Fix"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PROJECT_ROOT="/var/www/rafnet-cctv"
cd "$PROJECT_ROOT"

# 1. Fix PM2 EPIPE Error - Kill PM2 daemon completely
echo "🔧 Step 1: Fixing PM2 EPIPE Error..."

# Kill all PM2 processes
echo "   Stopping all PM2 processes..."
pm2 kill 2>/dev/null || true

# Wait for PM2 to fully stop
sleep 3

# Remove PM2 socket files that might be corrupted
echo "   Cleaning PM2 socket files..."
rm -rf /root/.pm2/pub.sock 2>/dev/null || true
rm -rf /root/.pm2/rpc.sock 2>/dev/null || true

echo "   ✅ PM2 daemon cleaned"

# 2. Fix Backend binding to allow external access
echo ""
echo "🔧 Step 2: Configuring Backend for external access..."

# Update backend .env to bind to 0.0.0.0
if [ -f "backend/.env" ]; then
    # Backup existing .env
    cp backend/.env backend/.env.backup
    
    # Update HOST to 0.0.0.0 for external access
    if grep -q "^HOST=" backend/.env; then
        sed -i 's/^HOST=.*/HOST=0.0.0.0/' backend/.env
    else
        echo "HOST=0.0.0.0" >> backend/.env
    fi
    
    echo "   ✅ Backend configured to bind to 0.0.0.0 (accessible from 172.17.11.12)"
else
    echo "   Creating backend .env file..."
    cat > backend/.env << 'EOF'
# RAF NET CCTV Backend Configuration - Ubuntu 20.04
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_PATH=/var/www/rafnet-cctv/data/cctv.db

# JWT Configuration
JWT_SECRET=rafnet-cctv-production-secret-change-this
JWT_EXPIRATION=24h

# MediaMTX Configuration
MEDIAMTX_API_URL=http://127.0.0.1:9997
MEDIAMTX_HLS_URL=http://172.17.11.12:8888
MEDIAMTX_WEBRTC_URL=http://172.17.11.12:8889

# CORS - Accept all origins for Ubuntu 20.04
CORS_ORIGIN=*
EOF
    echo "   ✅ Backend .env created with external access configuration"
fi

# 3. Update PM2 ecosystem to use 0.0.0.0
echo ""
echo "🔧 Step 3: Updating PM2 ecosystem configuration..."

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
                NODE_ENV: 'production',
                PORT: 3000,
                HOST: '0.0.0.0'
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
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            error_file: path.join(ROOT_DIR, 'logs/mediamtx-error.log'),
            out_file: path.join(ROOT_DIR, 'logs/mediamtx-out.log'),
            log_file: path.join(ROOT_DIR, 'logs/mediamtx-combined.log')
        }
    ]
};
EOF

echo "   ✅ PM2 ecosystem updated with HOST=0.0.0.0"

# 4. Ensure logs directory exists
echo ""
echo "🔧 Step 4: Ensuring directories exist..."
mkdir -p logs
mkdir -p data
chmod 755 logs data
echo "   ✅ Directories ready"

# 5. Start PM2 with fresh daemon
echo ""
echo "🔧 Step 5: Starting PM2 with fresh daemon..."

# Start PM2 daemon fresh
pm2 start deployment/ecosystem.ubuntu20.config.cjs --env production

# Wait for services to start
sleep 5

# Save PM2 configuration
pm2 save

echo "   ✅ PM2 started successfully"

# 6. Verify services
echo ""
echo "🔧 Step 6: Verifying services..."

echo ""
echo "📊 PM2 Process Status:"
pm2 list

echo ""
echo "🔍 Testing Backend on localhost..."
if curl -s http://127.0.0.1:3000/health > /dev/null 2>&1; then
    echo "   ✅ Backend responding on localhost:3000"
else
    echo "   ⚠️  Backend not responding on localhost:3000"
    echo "   Checking logs..."
    pm2 logs rafnet-cctv-backend --lines 10 --nostream 2>/dev/null || true
fi

echo ""
echo "🔍 Testing Backend on external IP..."
if curl -s http://172.17.11.12:3000/health > /dev/null 2>&1; then
    echo "   ✅ Backend responding on 172.17.11.12:3000"
else
    echo "   ⚠️  Backend not responding on 172.17.11.12:3000"
    echo "   This might be a firewall issue. Run: ufw allow 3000/tcp"
fi

echo ""
echo "🔍 Testing MediaMTX API..."
if curl -s http://127.0.0.1:9997/v3/config > /dev/null 2>&1; then
    echo "   ✅ MediaMTX API responding on localhost:9997"
else
    echo "   ⚠️  MediaMTX API not responding"
    pm2 logs mediamtx --lines 10 --nostream 2>/dev/null || true
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Post-Deployment Fix Complete!"
echo ""
echo "📋 What was fixed:"
echo "   ✓ PM2 EPIPE error resolved (daemon restarted)"
echo "   ✓ Backend now binds to 0.0.0.0 (accessible from 172.17.11.12)"
echo "   ✓ PM2 ecosystem updated"
echo ""
echo "🌐 Access Points:"
echo "   Frontend: http://cctv.raf.my.id or http://172.17.11.12"
echo "   Backend API: http://172.17.11.12:3000"
echo "   Backend Health: http://172.17.11.12:3000/health"
echo "   MediaMTX HLS: http://172.17.11.12:8888"
echo "   MediaMTX WebRTC: http://172.17.11.12:8889"
echo ""
echo "🔧 If backend still not accessible from external IP:"
echo "   ufw allow 3000/tcp"
echo "   ufw allow 8888/tcp"
echo "   ufw allow 8889/tcp"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
