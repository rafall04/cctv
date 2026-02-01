#!/bin/bash

# ============================================
# Environment Files Generator
# ============================================
# Generates .env files for backend and frontend
# based on client-specific configuration
#
# Usage:
#   ./generate-env-files.sh
#
# Interactive prompts for:
# - Frontend domain
# - Backend API domain
# - Server IP
# - Port (optional)
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Generate random secret
generate_secret() {
    local length=$1
    node -e "console.log(require('crypto').randomBytes($length).toString('hex'))"
}

print_header "RAF NET CCTV - Environment Files Generator"

echo ""
echo "This script will generate .env files for backend and frontend."
echo "Please provide the following information:"
echo ""

# ============================================
# Collect Configuration
# ============================================

# Frontend domain
read -p "Frontend domain (e.g., cctv.raf.my.id): " FRONTEND_DOMAIN
if [ -z "$FRONTEND_DOMAIN" ]; then
    print_error "Frontend domain is required!"
    exit 1
fi

# Backend API domain
read -p "Backend API domain (e.g., api-cctv.raf.my.id): " BACKEND_DOMAIN
if [ -z "$BACKEND_DOMAIN" ]; then
    print_error "Backend API domain is required!"
    exit 1
fi

# Server IP
read -p "Server IP address (e.g., 172.17.11.12): " SERVER_IP
if [ -z "$SERVER_IP" ]; then
    print_error "Server IP is required!"
    exit 1
fi

# Port (optional)
read -p "Public port [default: 800]: " PORT_PUBLIC
PORT_PUBLIC=${PORT_PUBLIC:-800}

# Protocol
read -p "Use HTTPS? (y/n) [default: y]: " USE_HTTPS
USE_HTTPS=${USE_HTTPS:-y}

if [ "$USE_HTTPS" = "y" ] || [ "$USE_HTTPS" = "Y" ]; then
    PROTOCOL="https"
else
    PROTOCOL="http"
fi

# Telegram (optional)
read -p "Telegram Bot Token (optional, press Enter to skip): " TELEGRAM_BOT_TOKEN
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    read -p "Telegram Monitoring Chat ID: " TELEGRAM_MONITORING_CHAT_ID
    read -p "Telegram Feedback Chat ID: " TELEGRAM_FEEDBACK_CHAT_ID
fi

echo ""
print_header "Configuration Summary"
echo "Frontend Domain:    $FRONTEND_DOMAIN"
echo "Backend API Domain: $BACKEND_DOMAIN"
echo "Server IP:          $SERVER_IP"
echo "Public Port:        $PORT_PUBLIC"
echo "Protocol:           $PROTOCOL"
echo "Telegram:           $([ -n "$TELEGRAM_BOT_TOKEN" ] && echo 'Enabled' || echo 'Disabled')"
echo ""

read -p "Continue? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    print_warning "Cancelled by user"
    exit 0
fi

# ============================================
# Generate Secrets
# ============================================

print_header "Generating Security Secrets"

JWT_SECRET=$(generate_secret 32)
API_KEY_SECRET=$(generate_secret 32)
CSRF_SECRET=$(generate_secret 16)

print_success "JWT Secret generated"
print_success "API Key Secret generated"
print_success "CSRF Secret generated"

# ============================================
# Generate Backend .env
# ============================================

print_header "Generating Backend .env"

BACKEND_ENV_FILE="../backend/.env"

cat > "$BACKEND_ENV_FILE" << EOF
# RAF NET CCTV Backend Configuration
# Generated: $(date)
# ===================================

# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Database Configuration
DATABASE_PATH=./data/cctv.db

# ===================================
# JWT Configuration
# ===================================
JWT_SECRET=$JWT_SECRET
JWT_EXPIRATION=1h
JWT_REFRESH_EXPIRATION=7d

# ===================================
# MediaMTX Configuration (Internal)
# ===================================
MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_HLS_URL_INTERNAL=http://localhost:8888
MEDIAMTX_WEBRTC_URL_INTERNAL=http://localhost:8889

# ===================================
# Public Stream URLs
# ===================================
PUBLIC_STREAM_BASE_URL=$PROTOCOL://$BACKEND_DOMAIN
PUBLIC_HLS_PATH=/hls
PUBLIC_WEBRTC_PATH=/webrtc

# ===================================
# Domain Configuration
# ===================================
BACKEND_DOMAIN=$BACKEND_DOMAIN
FRONTEND_DOMAIN=$FRONTEND_DOMAIN
SERVER_IP=$SERVER_IP
PORT_PUBLIC=$PORT_PUBLIC

# ===================================
# CORS Configuration
# ===================================
CORS_ORIGIN=*

# ===================================
# Allowed Origins (Auto-Generated)
# ===================================
# Leave empty to auto-generate from FRONTEND_DOMAIN, SERVER_IP, PORT_PUBLIC
ALLOWED_ORIGINS=

# ===================================
# Security Configuration
# ===================================
API_KEY_VALIDATION_ENABLED=true
API_KEY_SECRET=$API_KEY_SECRET

CSRF_ENABLED=true
CSRF_SECRET=$CSRF_SECRET

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
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_MONITORING_CHAT_ID=$TELEGRAM_MONITORING_CHAT_ID
TELEGRAM_FEEDBACK_CHAT_ID=$TELEGRAM_FEEDBACK_CHAT_ID
EOF

print_success "Backend .env created: $BACKEND_ENV_FILE"

# ============================================
# Generate Frontend .env
# ============================================

print_header "Generating Frontend .env"

FRONTEND_ENV_FILE="../frontend/.env"

cat > "$FRONTEND_ENV_FILE" << EOF
# RAF NET CCTV Frontend Configuration
# Generated: $(date)
# ====================================

# Backend API URL
VITE_API_URL=$PROTOCOL://$BACKEND_DOMAIN

# Frontend Domain
VITE_FRONTEND_DOMAIN=$FRONTEND_DOMAIN

# API Key (will be generated after backend setup)
VITE_API_KEY=
EOF

print_success "Frontend .env created: $FRONTEND_ENV_FILE"

# ============================================
# Summary
# ============================================

print_header "Setup Complete!"

echo ""
echo "Next steps:"
echo ""
echo "1. Review generated .env files:"
echo "   - backend/.env"
echo "   - frontend/.env"
echo ""
echo "2. Initialize database:"
echo "   cd backend && npm run setup-db"
echo ""
echo "3. Generate API key (after backend running):"
echo "   curl -X POST http://localhost:3000/api/admin/api-keys \\"
echo "     -H 'Authorization: Bearer <admin-token>' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"name\":\"Frontend\",\"permissions\":[\"read\",\"write\"]}'"
echo ""
echo "4. Add API key to frontend/.env:"
echo "   VITE_API_KEY=<generated-key>"
echo ""
echo "5. Build frontend:"
echo "   cd frontend && npm run build"
echo ""
echo "6. Deploy with PM2 and Nginx"
echo ""

print_warning "IMPORTANT: Keep these secrets safe!"
echo "JWT_SECRET:     $JWT_SECRET"
echo "API_KEY_SECRET: $API_KEY_SECRET"
echo "CSRF_SECRET:    $CSRF_SECRET"
echo ""
