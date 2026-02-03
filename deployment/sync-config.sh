#!/bin/bash
# ============================================
# Configuration Sync Script
# ============================================
# Syncs configuration from client.config.sh
# to backend/.env and frontend/.env
#
# Usage:
#   bash deployment/sync-config.sh
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if client.config.sh exists
if [ ! -f "deployment/client.config.sh" ]; then
    print_error "client.config.sh not found!"
    exit 1
fi

# Load client configuration
source deployment/client.config.sh

print_header "Configuration Sync"
display_config

echo ""
read -p "Continue with this configuration? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    print_warning "Cancelled by user"
    exit 0
fi

# ============================================
# 1. Generate Backend .env
# ============================================

print_header "Generating Backend .env"

BACKEND_ENV_FILE="backend/.env"

# Backup existing .env
if [ -f "$BACKEND_ENV_FILE" ]; then
    cp "$BACKEND_ENV_FILE" "${BACKEND_ENV_FILE}.backup"
    print_success "Backed up existing .env to .env.backup"
fi

cat > "$BACKEND_ENV_FILE" << EOF
# RAF NET CCTV Backend Configuration
# Auto-generated: $(date)
# Source: deployment/client.config.sh
# ===================================

# Server Configuration
PORT=${PORT_BACKEND}
HOST=0.0.0.0
NODE_ENV=production

# Database Configuration
DATABASE_PATH=${DATABASE_PATH}

# ===================================
# JWT Configuration
# ===================================
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRATION=1h
JWT_REFRESH_EXPIRATION=7d

# ===================================
# MediaMTX Configuration (Internal)
# ===================================
MEDIAMTX_API_URL=http://localhost:${PORT_MEDIAMTX_API}
MEDIAMTX_HLS_URL_INTERNAL=http://localhost:${PORT_MEDIAMTX_HLS}
MEDIAMTX_WEBRTC_URL_INTERNAL=http://localhost:${PORT_MEDIAMTX_WEBRTC}

# ===================================
# Public Stream URLs
# ===================================
PUBLIC_STREAM_BASE_URL=${PUBLIC_STREAM_BASE_URL}
PUBLIC_HLS_PATH=/hls
PUBLIC_WEBRTC_PATH=/webrtc

# ===================================
# Domain Configuration
# ===================================
BACKEND_DOMAIN=${BACKEND_DOMAIN}
FRONTEND_DOMAIN=${FRONTEND_DOMAIN}
SERVER_IP=${SERVER_IP}
PORT_PUBLIC=${PORT_PUBLIC}

# ===================================
# CORS Configuration
# ===================================
CORS_ORIGIN=*

# ===================================
# Allowed Origins (Auto-Generated)
# ===================================
ALLOWED_ORIGINS=${ALLOWED_ORIGINS}

# ===================================
# Security Configuration
# ===================================
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

# ===================================
# Telegram Bot (Optional)
# ===================================
TELEGRAM_BOT_TOKEN=
TELEGRAM_MONITORING_CHAT_ID=
TELEGRAM_FEEDBACK_CHAT_ID=
EOF

print_success "Backend .env generated"

# ============================================
# 2. Generate Frontend .env
# ============================================

print_header "Generating Frontend .env"

FRONTEND_ENV_FILE="frontend/.env"

# Backup existing .env
if [ -f "$FRONTEND_ENV_FILE" ]; then
    # Preserve API key if exists
    EXISTING_API_KEY=$(grep "VITE_API_KEY=" "$FRONTEND_ENV_FILE" | cut -d'=' -f2)
    cp "$FRONTEND_ENV_FILE" "${FRONTEND_ENV_FILE}.backup"
    print_success "Backed up existing .env to .env.backup"
fi

cat > "$FRONTEND_ENV_FILE" << EOF
# RAF NET CCTV Frontend Configuration
# Auto-generated: $(date)
# Source: deployment/client.config.sh
# ====================================

# Backend API URL
VITE_API_URL=${BACKEND_URL}

# Frontend Domain
VITE_FRONTEND_DOMAIN=${FRONTEND_DOMAIN}

# Frontend Dev Server Port
VITE_PORT=${PORT_FRONTEND_DEV}

# API Key (preserved from previous config or set manually)
VITE_API_KEY=${EXISTING_API_KEY:-}
EOF

print_success "Frontend .env generated"

if [ -z "$EXISTING_API_KEY" ]; then
    print_warning "API Key not set! Generate it from backend admin panel"
fi

# ============================================
# 3. Rebuild Frontend
# ============================================

print_header "Rebuilding Frontend"

cd frontend
npm run build
cd ..

print_success "Frontend rebuilt"

# ============================================
# 4. Restart Backend (if PM2 running)
# ============================================

print_header "Restarting Services"

if command -v pm2 &> /dev/null; then
    if pm2 list | grep -q "${CLIENT_CODE}-cctv-backend"; then
        pm2 restart ${CLIENT_CODE}-cctv-backend
        print_success "Backend restarted"
    else
        print_warning "Backend not running in PM2"
    fi
else
    print_warning "PM2 not found, skip restart"
fi

# ============================================
# Summary
# ============================================

print_header "Sync Complete!"

echo ""
echo "Configuration synced successfully!"
echo ""
echo "URLs:"
echo "  Frontend: ${FRONTEND_URL}"
echo "  Backend:  ${BACKEND_URL}"
echo "  IP Access: http://${SERVER_IP}:${PORT_PUBLIC}"
echo ""
echo "Ports:"
echo "  Public (Nginx/Apache): ${PORT_PUBLIC}"
echo "  Backend (Fastify):     ${PORT_BACKEND}"
echo "  MediaMTX HLS:          ${PORT_MEDIAMTX_HLS}"
echo "  MediaMTX API:          ${PORT_MEDIAMTX_API}"
echo ""
echo "Next steps:"
echo "1. Test frontend: ${FRONTEND_URL}"
echo "2. Test backend: ${BACKEND_URL}/health"
echo "3. Check CORS: curl -v -H 'Origin: ${FRONTEND_URL}' ${BACKEND_URL}/api/cameras/active"
echo ""

if [ -z "$EXISTING_API_KEY" ]; then
    echo "⚠️  Don't forget to set VITE_API_KEY in frontend/.env!"
    echo ""
fi
