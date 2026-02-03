#!/bin/bash
# ============================================
# RAF NET CCTV - Environment File Generator
# ============================================
# Generate .env files dari client.config.sh
# 
# Usage:
#   bash deployment/generate-env.sh
#
# Setelah generate:
#   1. Edit backend/.env untuk update secrets (optional)
#   2. Edit frontend/.env untuk update API key
#   3. Deploy: bash deployment/deploy.sh

set -e

# Load client configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "${SCRIPT_DIR}/client.config.sh" ]; then
    echo "❌ Error: client.config.sh not found!"
    echo ""
    echo "Please run installation script first:"
    echo "  bash deployment/install.sh"
    echo "  or"
    echo "  bash deployment/aapanel-install.sh"
    echo ""
    echo "This will generate client.config.sh with your domain and IP configuration."
    exit 1
fi

source "${SCRIPT_DIR}/client.config.sh"

# Detect if running in aaPanel (check common paths)
if [ -d "/www/server/nginx" ]; then
    echo "🔍 Detected aaPanel environment"
    NGINX_CONF_DIR="/www/server/panel/vhost/nginx"
    APP_DIR="/var/www/cctv"
else
    echo "🔍 Detected standard Ubuntu environment"
    NGINX_CONF_DIR="/etc/nginx/sites-available"
    APP_DIR="/var/www/cctv"
fi

echo "============================================"
echo "Generating Environment Files"
echo "============================================"
echo "Client: $CLIENT_NAME"
echo "App Dir: $APP_DIR"
echo ""

# ============================================
# Generate Backend .env
# ============================================
echo "📝 Generating backend/.env..."

# Create backend directory if not exists
mkdir -p "${APP_DIR}/backend"

cat > "${APP_DIR}/backend/.env" << EOF
# RAF NET CCTV Backend Configuration
# Auto-generated from deployment/client.config.sh
# Client: ${CLIENT_NAME}
# Generated: $(date)

# Server Configuration
PORT=${BACKEND_PORT}
HOST=0.0.0.0
NODE_ENV=production

# Database Configuration
DATABASE_PATH=./data/cctv.db

# JWT Configuration
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRATION=1h
JWT_REFRESH_EXPIRATION=7d

# MediaMTX Configuration (Internal)
MEDIAMTX_API_URL=http://localhost:${MEDIAMTX_API_PORT}
MEDIAMTX_HLS_URL_INTERNAL=http://localhost:${MEDIAMTX_HLS_PORT}
MEDIAMTX_WEBRTC_URL_INTERNAL=http://localhost:${MEDIAMTX_WEBRTC_PORT}

# Public Stream URLs
PUBLIC_STREAM_BASE_URL=${PUBLIC_STREAM_BASE_URL}
PUBLIC_HLS_PATH=/hls
PUBLIC_WEBRTC_PATH=/webrtc

# CORS Configuration
CORS_ORIGIN=*

# Security Configuration
API_KEY_VALIDATION_ENABLED=true
API_KEY_SECRET=${API_KEY_SECRET}

CSRF_ENABLED=true
CSRF_SECRET=${CSRF_SECRET}

RATE_LIMIT_ENABLED=true
RATE_LIMIT_PUBLIC=100
RATE_LIMIT_AUTH=30
RATE_LIMIT_ADMIN=60

BRUTE_FORCE_ENABLED=true
MAX_LOGIN_ATTEMPTS=5
MAX_IP_ATTEMPTS=10
LOCKOUT_DURATION_MINUTES=30
IP_BLOCK_DURATION_MINUTES=60

SESSION_ABSOLUTE_TIMEOUT_HOURS=24

PASSWORD_MIN_LENGTH=12
PASSWORD_MAX_AGE_DAYS=90
PASSWORD_HISTORY_COUNT=5

AUDIT_LOG_RETENTION_DAYS=90

# Allowed Origins
ALLOWED_ORIGINS=${ALLOWED_ORIGINS}

# Telegram Bot Configuration (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_MONITORING_CHAT_ID=
TELEGRAM_FEEDBACK_CHAT_ID=
EOF

echo "✅ Backend .env generated at: ${APP_DIR}/backend/.env"

# ============================================
# Generate Frontend .env
# ============================================
echo "📝 Generating frontend/.env..."

# Create frontend directory if not exists
mkdir -p "${APP_DIR}/frontend"

cat > "${APP_DIR}/frontend/.env" << EOF
# RAF NET CCTV Frontend Configuration
# Auto-generated from deployment/client.config.sh
# Client: ${CLIENT_NAME}
# Generated: $(date)

# Backend API URL
VITE_API_URL=${BACKEND_URL}

# API Key (generate from admin panel)
VITE_API_KEY=CHANGE_THIS_TO_YOUR_API_KEY
EOF

echo "✅ Frontend .env generated at: ${APP_DIR}/frontend/.env"

# ============================================
# Generate Nginx Configuration
# ============================================
echo "📝 Generating nginx configuration..."

cat > "${APP_DIR}/deployment/nginx.generated.conf" << 'NGINX_EOF'
# RAF NET CCTV - Nginx Configuration
# Auto-generated from deployment/client.config.sh
# DO NOT EDIT MANUALLY - Edit client.config.sh instead

# RAM Cache Configuration
proxy_cache_path /dev/shm/nginx-cache 
    levels=1:2 
    keys_zone=hls_cache:10m 
    max_size=200m 
    inactive=10m 
    use_temp_path=off;

# Block MediaMTX API Access
server {
    listen NGINX_PORT_PLACEHOLDER;
    listen [::]:NGINX_PORT_PLACEHOLDER;
    
    server_name mediamtx.FRONTEND_DOMAIN_PLACEHOLDER mtx.FRONTEND_DOMAIN_PLACEHOLDER;
    
    location / {
        deny all;
        return 403 "MediaMTX API access forbidden";
    }
}

# Frontend Server
server {
    listen NGINX_PORT_PLACEHOLDER;
    listen [::]:NGINX_PORT_PLACEHOLDER;

    server_name FRONTEND_DOMAIN_PLACEHOLDER SERVER_IP_PLACEHOLDER;

    root APP_DIR_PLACEHOLDER/frontend/dist;
    index index.html;

    # Security: Block sensitive files
    location ~ /\.env { deny all; return 404; }
    location ~ /\.git { deny all; return 404; }
    location ~ \.(bak|backup|old|sql|db|sqlite)$ { deny all; return 404; }
    location ~ /node_modules/ { deny all; return 404; }

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Service Worker
    location = /sw.js {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        try_files $uri =404;
    }

    # Recording Playback (MUST be before /api/)
    location /api/recordings/ {
        proxy_pass http://localhost:BACKEND_PORT_PLACEHOLDER;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Range $http_range;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # Backend API Proxy
    location /api/ {
        proxy_pass http://localhost:BACKEND_PORT_PLACEHOLDER;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # HLS Stream Proxy
    location /hls/ {
        proxy_pass http://localhost:BACKEND_PORT_PLACEHOLDER;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache hls_cache;
        proxy_cache_valid 200 2s;
        add_header X-Cache-Status $upstream_cache_status;
    }

    # React SPA
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    access_log /var/log/nginx/CLIENT_CODE_PLACEHOLDER-frontend.access.log;
    error_log /var/log/nginx/CLIENT_CODE_PLACEHOLDER-frontend.error.log;
}

# Backend API Server
server {
    listen NGINX_PORT_PLACEHOLDER;
    listen [::]:NGINX_PORT_PLACEHOLDER;

    server_name BACKEND_DOMAIN_PLACEHOLDER;

    client_max_body_size 10M;

    # Security: Block sensitive files
    location ~ /\.env { deny all; return 404; }
    location ~ /\.git { deny all; return 404; }
    location ~ \.(bak|backup|old|sql|db|sqlite)$ { deny all; return 404; }
    location ~ /node_modules/ { deny all; return 404; }

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # HLS Stream Proxy
    location /hls/ {
        proxy_pass http://localhost:BACKEND_PORT_PLACEHOLDER;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache hls_cache;
        proxy_cache_valid 200 2s;
        add_header X-Cache-Status $upstream_cache_status;
    }

    # Recording Playback
    location /api/recordings/ {
        proxy_pass http://localhost:BACKEND_PORT_PLACEHOLDER;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Range $http_range;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # Backend API
    location / {
        proxy_pass http://localhost:BACKEND_PORT_PLACEHOLDER;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    access_log /var/log/nginx/CLIENT_CODE_PLACEHOLDER-backend.access.log;
    error_log /var/log/nginx/CLIENT_CODE_PLACEHOLDER-backend.error.log;
}
NGINX_EOF

# Replace placeholders
sed -i "s|NGINX_PORT_PLACEHOLDER|${NGINX_PORT}|g" "${APP_DIR}/deployment/nginx.generated.conf"
sed -i "s|FRONTEND_DOMAIN_PLACEHOLDER|${FRONTEND_DOMAIN}|g" "${APP_DIR}/deployment/nginx.generated.conf"
sed -i "s|BACKEND_DOMAIN_PLACEHOLDER|${BACKEND_DOMAIN}|g" "${APP_DIR}/deployment/nginx.generated.conf"
sed -i "s|SERVER_IP_PLACEHOLDER|${SERVER_IP}|g" "${APP_DIR}/deployment/nginx.generated.conf"
sed -i "s|APP_DIR_PLACEHOLDER|${APP_DIR}|g" "${APP_DIR}/deployment/nginx.generated.conf"
sed -i "s|BACKEND_PORT_PLACEHOLDER|${BACKEND_PORT}|g" "${APP_DIR}/deployment/nginx.generated.conf"
sed -i "s|CLIENT_CODE_PLACEHOLDER|${CLIENT_CODE}|g" "${APP_DIR}/deployment/nginx.generated.conf"

echo "✅ Nginx configuration generated"

# ============================================
# Summary
# ============================================
echo ""
echo "============================================"
echo "✅ Environment Files Generated Successfully"
echo "============================================"
echo ""
echo "📁 Generated files:"
echo "  ✓ ${APP_DIR}/backend/.env"
echo "  ✓ ${APP_DIR}/frontend/.env"
echo "  ✓ ${APP_DIR}/deployment/nginx.generated.conf"
echo ""
echo "⚠️  IMPORTANT - Update Secrets:"
echo "  1. Edit ${APP_DIR}/backend/.env"
echo "     - Update API_KEY_SECRET (generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
echo "     - Update CSRF_SECRET (generate: node -e \"console.log(require('crypto').randomBytes(16).toString('hex'))\")"
echo ""
echo "  2. Generate API Key from admin panel"
echo "     - Login to admin panel"
echo "     - Go to Settings > API Keys"
echo "     - Generate new key"
echo ""
echo "  3. Edit ${APP_DIR}/frontend/.env"
echo "     - Update VITE_API_KEY with generated key"
echo ""
echo "📋 Next Steps:"
echo "  1. Copy nginx config:"
if [ -d "/www/server/nginx" ]; then
    echo "     cp ${APP_DIR}/deployment/nginx.generated.conf ${NGINX_CONF_DIR}/${CLIENT_CODE}-cctv.conf"
else
    echo "     cp ${APP_DIR}/deployment/nginx.generated.conf ${NGINX_CONF_DIR}/${CLIENT_CODE}-cctv"
    echo "     ln -sf ${NGINX_CONF_DIR}/${CLIENT_CODE}-cctv /etc/nginx/sites-enabled/"
fi
echo ""
echo "  2. Test nginx:"
echo "     nginx -t"
echo ""
echo "  3. Reload nginx:"
if [ -d "/www/server/nginx" ]; then
    echo "     /etc/init.d/nginx reload"
else
    echo "     systemctl reload nginx"
fi
echo ""
echo "  4. Restart backend:"
echo "     pm2 restart ${CLIENT_CODE}-cctv-backend"
echo ""
echo "  5. Rebuild frontend:"
echo "     cd ${APP_DIR}/frontend && npm run build"
echo ""
echo "🌐 Access URLs:"
echo "  Frontend: ${FRONTEND_URL}"
echo "  Backend:  ${BACKEND_URL}"
echo "  IP:       http://${SERVER_IP}:${NGINX_PORT}"
echo ""
echo "============================================"
