#!/bin/bash
# ============================================
# RAF NET CCTV - Fix Stream Architecture
# ============================================
# This script fixes the stream URL architecture:
# - Backend returns RELATIVE URLs (/hls/camera1/index.m3u8)
# - Frontend prepends API base URL
# - Nginx proxies /hls/* to MediaMTX
# 
# This ensures MediaMTX is never directly exposed to the internet
# ============================================

set -e

echo "============================================"
echo "RAF NET CCTV - Fix Stream Architecture"
echo "============================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root${NC}"
    exit 1
fi

APP_DIR="/var/www/rafnet-cctv"

# Check if app directory exists
if [ ! -d "$APP_DIR" ]; then
    echo -e "${RED}Application directory not found: $APP_DIR${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Updating backend .env configuration...${NC}"

# Backup current .env
if [ -f "$APP_DIR/backend/.env" ]; then
    cp "$APP_DIR/backend/.env" "$APP_DIR/backend/.env.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Create new backend .env with correct configuration
cat > "$APP_DIR/backend/.env" << 'EOF'
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# JWT Configuration
JWT_SECRET=change-this-to-a-secure-random-string-in-production
JWT_EXPIRATION=24h

# MediaMTX Configuration
# Internal URLs - backend uses these to communicate with MediaMTX directly
MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_HLS_URL_INTERNAL=http://localhost:8888
MEDIAMTX_WEBRTC_URL_INTERNAL=http://localhost:8889

# Public URLs - returned to frontend (ALWAYS use relative paths!)
# Frontend will access streams via same origin, nginx proxies to MediaMTX
# Example: /hls/camera1/index.m3u8 -> nginx -> localhost:8888/camera1/index.m3u8
PUBLIC_HLS_URL=/hls
PUBLIC_WEBRTC_URL=/webrtc

# Database Configuration
DATABASE_PATH=/var/www/rafnet-cctv/data/cctv.db

# CORS Configuration (use * for production to accept all origins)
CORS_ORIGIN=*
EOF

echo -e "${GREEN}✓ Backend .env updated${NC}"

echo ""
echo -e "${YELLOW}Step 2: Updating frontend .env configuration...${NC}"

# Backup current frontend .env
if [ -f "$APP_DIR/frontend/.env" ]; then
    cp "$APP_DIR/frontend/.env" "$APP_DIR/frontend/.env.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Create new frontend .env
cat > "$APP_DIR/frontend/.env" << 'EOF'
# RAF NET CCTV Frontend Configuration
# API URL - Backend server URL
VITE_API_URL=https://api-cctv.raf.my.id
EOF

echo -e "${GREEN}✓ Frontend .env updated${NC}"

echo ""
echo -e "${YELLOW}Step 3: Updating Nginx configuration...${NC}"

# Backup current nginx config
if [ -f "/etc/nginx/sites-available/cctv" ]; then
    cp "/etc/nginx/sites-available/cctv" "/etc/nginx/sites-available/cctv.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Create new nginx config
cat > "/etc/nginx/sites-available/cctv" << 'EOF'
# RAF NET CCTV - Nginx Configuration
# ===================================

# Server block for the Frontend Application
server {
    listen 80;
    listen [::]:80;

    server_name cctv.raf.my.id 172.17.11.12;

    root /var/www/rafnet-cctv/frontend/dist;
    index index.html;

    # Serve React SPA
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    access_log /var/log/nginx/rafnet-cctv-frontend.access.log;
    error_log /var/log/nginx/rafnet-cctv-frontend.error.log;
}

# Server block for the Backend API (Reverse Proxy)
server {
    listen 80;
    listen [::]:80;

    server_name api-cctv.raf.my.id;

    client_max_body_size 10M;

    # HLS Stream Proxy
    # Frontend requests: /hls/camera1/index.m3u8
    # Proxied to: localhost:8888/camera1/index.m3u8
    location /hls/ {
        rewrite ^/hls/(.*)$ /$1 break;
        proxy_pass http://localhost:8888;
        
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Origin, Content-Type, Accept, Range' always;
        
        if ($request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' '*';
            add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS';
            add_header 'Access-Control-Allow-Headers' 'Origin, Content-Type, Accept, Range';
            add_header 'Access-Control-Max-Age' 1728000;
            add_header 'Content-Type' 'text/plain charset=UTF-8';
            add_header 'Content-Length' 0;
            return 204;
        }
        
        proxy_buffering off;
        proxy_cache off;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebRTC Proxy
    location /webrtc/ {
        rewrite ^/webrtc/(.*)$ /$1 break;
        proxy_pass http://localhost:8889;
        
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        add_header 'Access-Control-Allow-Origin' '*' always;
    }

    # Backend API Proxy
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    access_log /var/log/nginx/rafnet-cctv-backend.access.log;
    error_log /var/log/nginx/rafnet-cctv-backend.error.log;
}
EOF

# Test nginx configuration
nginx -t
if [ $? -ne 0 ]; then
    echo -e "${RED}Nginx configuration test failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Nginx configuration updated${NC}"

echo ""
echo -e "${YELLOW}Step 4: Rebuilding frontend...${NC}"

cd "$APP_DIR/frontend"
npm run build

echo -e "${GREEN}✓ Frontend rebuilt${NC}"

echo ""
echo -e "${YELLOW}Step 5: Restarting services...${NC}"

# Restart backend
pm2 restart cctv-backend 2>/dev/null || pm2 start "$APP_DIR/deployment/ecosystem.config.cjs" 2>/dev/null || echo "PM2 restart skipped"

# Restart nginx
systemctl reload nginx

echo -e "${GREEN}✓ Services restarted${NC}"

echo ""
echo "============================================"
echo -e "${GREEN}Stream Architecture Fix Complete!${NC}"
echo "============================================"
echo ""
echo "Architecture Summary:"
echo "  1. Backend returns relative URLs: /hls/camera1/index.m3u8"
echo "  2. Frontend prepends API base URL: https://api-cctv.raf.my.id/hls/camera1/index.m3u8"
echo "  3. Nginx proxies /hls/* to MediaMTX at localhost:8888"
echo ""
echo "Test the fix:"
echo "  curl https://api-cctv.raf.my.id/api/stream"
echo "  # Should return URLs like: /hls/camera1/index.m3u8"
echo ""
echo "  curl https://api-cctv.raf.my.id/hls/camera1/index.m3u8"
echo "  # Should return HLS manifest from MediaMTX"
echo ""
