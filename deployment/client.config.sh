#!/bin/bash
# ============================================
# RAF NET CCTV - Client Configuration
# ============================================
# EDIT FILE INI UNTUK GANTI DOMAIN/IP/PORT
# Setelah edit, jalankan: bash deployment/sync-config.sh

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
# Public port (Nginx/Apache - untuk akses dari luar)
# Default: 800 (jika port 80 dipakai aaPanel)
# Ubah sesuai kebutuhan: 80, 443, 800, dll
PORT_PUBLIC="800"

# Backend API port (internal - port dimana Fastify berjalan)
# Default: 3000
# Ubah jika port 3000 sudah dipakai aplikasi lain
PORT_BACKEND="3000"

# Frontend dev port (hanya untuk development)
# Default: 5173
# Ubah jika port 5173 sudah dipakai
PORT_FRONTEND_DEV="5173"

# MediaMTX ports (internal - untuk streaming)
# Default: HLS=8888, WebRTC=8889, API=9997
# Ubah jika port sudah dipakai aplikasi lain
PORT_MEDIAMTX_HLS="8888"
PORT_MEDIAMTX_WEBRTC="8889"
PORT_MEDIAMTX_API="9997"

# ============================================
# PROTOCOL CONFIGURATION
# ============================================
# Use 'https' for production with SSL, 'http' for development
# Auto-detect: jika PORT_PUBLIC = 443, gunakan https
FRONTEND_PROTOCOL="http"
BACKEND_PROTOCOL="http"

# Override auto-detection (optional)
# Uncomment untuk force protocol tertentu
# FRONTEND_PROTOCOL="https"
# BACKEND_PROTOCOL="https"

# ============================================
# PATH CONFIGURATION
# ============================================
# Application directory on server
# Default: /var/www/rafnet-cctv
# Ubah sesuai lokasi instalasi
APP_DIR="/var/www/rafnet-cctv"

# Database path (relative to APP_DIR)
DATABASE_PATH="./data/cctv.db"

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
# Auto-generate berdasarkan konfigurasi di atas

generate_allowed_origins() {
    local origins=""
    
    # Frontend domain dengan protocol dan port
    local frontend_url="${FRONTEND_PROTOCOL}://${FRONTEND_DOMAIN}"
    if [ "$PORT_PUBLIC" != "80" ] && [ "$PORT_PUBLIC" != "443" ]; then
        frontend_url="${frontend_url}:${PORT_PUBLIC}"
    fi
    origins="${frontend_url}"
    
    # Backend domain dengan protocol dan port
    local backend_url="${BACKEND_PROTOCOL}://${BACKEND_DOMAIN}"
    if [ "$PORT_PUBLIC" != "80" ] && [ "$PORT_PUBLIC" != "443" ]; then
        backend_url="${backend_url}:${PORT_PUBLIC}"
    fi
    origins="${origins},${backend_url}"
    
    # Server IP dengan port public
    if [ "$PORT_PUBLIC" != "80" ] && [ "$PORT_PUBLIC" != "443" ]; then
        origins="${origins},http://${SERVER_IP}:${PORT_PUBLIC}"
    fi
    origins="${origins},http://${SERVER_IP}"
    
    # Localhost untuk development (semua port yang digunakan)
    origins="${origins},http://localhost:${PORT_FRONTEND_DEV}"
    origins="${origins},http://localhost:${PORT_BACKEND}"
    origins="${origins},http://localhost:${PORT_PUBLIC}"
    
    echo "$origins"
}

# ============================================
# PUBLIC STREAM URL (Auto-generated)
# ============================================
generate_public_stream_url() {
    local url="${BACKEND_PROTOCOL}://${BACKEND_DOMAIN}"
    if [ "$PORT_PUBLIC" != "80" ] && [ "$PORT_PUBLIC" != "443" ]; then
        url="${url}:${PORT_PUBLIC}"
    fi
    echo "$url"
}

# ============================================
# FRONTEND URL (Auto-generated)
# ============================================
generate_frontend_url() {
    local url="${FRONTEND_PROTOCOL}://${FRONTEND_DOMAIN}"
    if [ "$PORT_PUBLIC" != "80" ] && [ "$PORT_PUBLIC" != "443" ]; then
        url="${url}:${PORT_PUBLIC}"
    fi
    echo "$url"
}

# ============================================
# BACKEND URL (Auto-generated)
# ============================================
generate_backend_url() {
    local url="${BACKEND_PROTOCOL}://${BACKEND_DOMAIN}"
    if [ "$PORT_PUBLIC" != "80" ] && [ "$PORT_PUBLIC" != "443" ]; then
        url="${url}:${PORT_PUBLIC}"
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
export PORT_PUBLIC
export PORT_BACKEND
export PORT_FRONTEND_DEV
export PORT_MEDIAMTX_HLS
export PORT_MEDIAMTX_WEBRTC
export PORT_MEDIAMTX_API
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
    echo "  IP Access: http://${SERVER_IP}:${PORT_PUBLIC}"
    echo ""
    echo "Ports:"
    echo "  Public (Nginx/Apache): $PORT_PUBLIC"
    echo "  Backend (Fastify):     $PORT_BACKEND"
    echo "  Frontend Dev (Vite):   $PORT_FRONTEND_DEV"
    echo "  MediaMTX HLS:          $PORT_MEDIAMTX_HLS"
    echo "  MediaMTX WebRTC:       $PORT_MEDIAMTX_WEBRTC"
    echo "  MediaMTX API:          $PORT_MEDIAMTX_API"
    echo ""
    echo "Allowed Origins:"
    echo "  $ALLOWED_ORIGINS"
    echo ""
    echo "Paths:"
    echo "  App Directory: $APP_DIR"
    echo "  Database:      $DATABASE_PATH"
    echo "============================================"
}

# Show config if script is run directly
if [ "${BASH_SOURCE[0]}" -ef "$0" ]; then
    display_config
fi
