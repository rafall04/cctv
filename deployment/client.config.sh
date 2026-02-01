#!/bin/bash
# ============================================
# RAF NET CCTV - Client Configuration
# ============================================
# Edit file ini untuk setiap client baru
# Semua domain, IP, dan port dikonfigurasi di sini

# ============================================
# CLIENT INFORMATION
# ============================================
CLIENT_NAME="RAF NET"
CLIENT_CODE="rafnet"

# ============================================
# DOMAIN CONFIGURATION
# ============================================
# Frontend domain (untuk akses publik)
FRONTEND_DOMAIN="cctv.raf.my.id"

# Backend API domain
BACKEND_DOMAIN="api-cctv.raf.my.id"

# Server IP (untuk akses langsung via IP)
SERVER_IP="172.17.11.12"

# ============================================
# PORT CONFIGURATION
# ============================================
# Nginx port (gunakan 800 jika port 80 dipakai aaPanel)
NGINX_PORT="800"

# Backend API port (internal)
BACKEND_PORT="3000"

# MediaMTX ports (internal)
MEDIAMTX_HLS_PORT="8888"
MEDIAMTX_WEBRTC_PORT="8889"
MEDIAMTX_API_PORT="9997"

# ============================================
# PROTOCOL CONFIGURATION
# ============================================
# Use 'https' for production with SSL, 'http' for development
FRONTEND_PROTOCOL="http"
BACKEND_PROTOCOL="https"

# ============================================
# PATH CONFIGURATION
# ============================================
# Application directory on server
APP_DIR="/var/www/rafnet-cctv"

# Database path
DATABASE_PATH="${APP_DIR}/backend/data/cctv.db"

# ============================================
# SECURITY CONFIGURATION
# ============================================
# JWT Secret (change for each client!)
JWT_SECRET="raf_net_secure_cctv_2025_prod"

# API Key Secret (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
API_KEY_SECRET="CHANGE_THIS_TO_64_CHAR_HEX_SECRET"

# CSRF Secret (generate with: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
CSRF_SECRET="CHANGE_THIS_TO_32_CHAR_HEX_SECRET"

# ============================================
# ALLOWED ORIGINS (Auto-generated)
# ============================================
# Format: protocol://domain:port
# Jangan edit manual, akan di-generate otomatis

generate_allowed_origins() {
    local origins=""
    
    # Frontend domain
    origins="${FRONTEND_PROTOCOL}://${FRONTEND_DOMAIN}"
    if [ "$NGINX_PORT" != "80" ] && [ "$NGINX_PORT" != "443" ]; then
        origins="${origins}:${NGINX_PORT}"
    fi
    
    # Backend domain
    origins="${origins},${BACKEND_PROTOCOL}://${BACKEND_DOMAIN}"
    if [ "$NGINX_PORT" != "80" ] && [ "$NGINX_PORT" != "443" ]; then
        origins="${origins}:${NGINX_PORT}"
    fi
    
    # Server IP with port
    origins="${origins},http://${SERVER_IP}:${NGINX_PORT}"
    
    # Server IP without port (fallback)
    origins="${origins},http://${SERVER_IP}"
    
    # Localhost for development
    origins="${origins},http://localhost:5173,http://localhost:3000,http://localhost:8080"
    
    echo "$origins"
}

# ============================================
# PUBLIC STREAM URL (Auto-generated)
# ============================================
generate_public_stream_url() {
    local url="${BACKEND_PROTOCOL}://${BACKEND_DOMAIN}"
    if [ "$NGINX_PORT" != "80" ] && [ "$NGINX_PORT" != "443" ]; then
        url="${url}:${NGINX_PORT}"
    fi
    echo "$url"
}

# ============================================
# FRONTEND URL (Auto-generated)
# ============================================
generate_frontend_url() {
    local url="${FRONTEND_PROTOCOL}://${FRONTEND_DOMAIN}"
    if [ "$NGINX_PORT" != "80" ] && [ "$NGINX_PORT" != "443" ]; then
        url="${url}:${NGINX_PORT}"
    fi
    echo "$url"
}

# ============================================
# BACKEND URL (Auto-generated)
# ============================================
generate_backend_url() {
    local url="${BACKEND_PROTOCOL}://${BACKEND_DOMAIN}"
    if [ "$NGINX_PORT" != "80" ] && [ "$NGINX_PORT" != "443" ]; then
        url="${url}:${NGINX_PORT}"
    fi
    echo "$url"
}

# ============================================
# EXPORT VARIABLES
# ============================================
export CLIENT_NAME
export CLIENT_CODE
export FRONTEND_DOMAIN
export BACKEND_DOMAIN
export SERVER_IP
export NGINX_PORT
export BACKEND_PORT
export MEDIAMTX_HLS_PORT
export MEDIAMTX_WEBRTC_PORT
export MEDIAMTX_API_PORT
export FRONTEND_PROTOCOL
export BACKEND_PROTOCOL
export APP_DIR
export DATABASE_PATH
export JWT_SECRET
export API_KEY_SECRET
export CSRF_SECRET
export ALLOWED_ORIGINS=$(generate_allowed_origins)
export PUBLIC_STREAM_BASE_URL=$(generate_public_stream_url)
export FRONTEND_URL=$(generate_frontend_url)
export BACKEND_URL=$(generate_backend_url)

# ============================================
# DISPLAY CONFIGURATION
# ============================================
display_config() {
    echo "============================================"
    echo "RAF NET CCTV - Client Configuration"
    echo "============================================"
    echo "Client: $CLIENT_NAME ($CLIENT_CODE)"
    echo ""
    echo "URLs:"
    echo "  Frontend: $FRONTEND_URL"
    echo "  Backend:  $BACKEND_URL"
    echo "  IP Access: http://${SERVER_IP}:${NGINX_PORT}"
    echo ""
    echo "Allowed Origins:"
    echo "  $ALLOWED_ORIGINS"
    echo ""
    echo "Ports:"
    echo "  Nginx: $NGINX_PORT"
    echo "  Backend: $BACKEND_PORT"
    echo "  MediaMTX HLS: $MEDIAMTX_HLS_PORT"
    echo "  MediaMTX API: $MEDIAMTX_API_PORT"
    echo "============================================"
}

# Show config if script is run directly
if [ "${BASH_SOURCE[0]}" -ef "$0" ]; then
    display_config
fi
