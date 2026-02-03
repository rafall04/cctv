#!/bin/bash
# RAF NET CCTV - Ubuntu Interactive Installer
# Run as root: sudo bash deployment/install.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }
print_header() { echo -e "${BLUE}$1${NC}"; }

echo ""
print_header "🚀 RAF NET CCTV - Interactive Installation"
print_header "============================================"
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run as root: sudo bash deployment/install.sh"
    exit 1
fi

# ============================================
# INTERACTIVE CONFIGURATION
# ============================================
print_header "📝 Installation Configuration"
echo ""

# Auto-detect IP
DETECTED_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "")

# Client Name
read -p "Client Name [RAF NET]: " CLIENT_NAME
CLIENT_NAME=${CLIENT_NAME:-"RAF NET"}
CLIENT_CODE=$(echo "$CLIENT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')

# Frontend Domain
read -p "Frontend Domain (e.g., cctv.client.com): " FRONTEND_DOMAIN
while [ -z "$FRONTEND_DOMAIN" ]; do
    print_error "Frontend domain is required!"
    read -p "Frontend Domain: " FRONTEND_DOMAIN
done

# Backend Domain
read -p "Backend Domain (e.g., api-cctv.client.com): " BACKEND_DOMAIN
while [ -z "$BACKEND_DOMAIN" ]; do
    print_error "Backend domain is required!"
    read -p "Backend Domain: " BACKEND_DOMAIN
done

# Server IP
read -p "Server IP [$DETECTED_IP]: " SERVER_IP
SERVER_IP=${SERVER_IP:-$DETECTED_IP}

# Ports
read -p "Public Port [800]: " PORT_PUBLIC
PORT_PUBLIC=${PORT_PUBLIC:-800}

read -p "Backend Port [3000]: " PORT_BACKEND
PORT_BACKEND=${PORT_BACKEND:-3000}

read -p "MediaMTX HLS Port [8888]: " PORT_MEDIAMTX_HLS
PORT_MEDIAMTX_HLS=${PORT_MEDIAMTX_HLS:-8888}

read -p "MediaMTX WebRTC Port [8889]: " PORT_MEDIAMTX_WEBRTC
PORT_MEDIAMTX_WEBRTC=${PORT_MEDIAMTX_WEBRTC:-8889}

read -p "MediaMTX API Port [9997]: " PORT_MEDIAMTX_API
PORT_MEDIAMTX_API=${PORT_MEDIAMTX_API:-9997}

# App Directory
read -p "Installation Directory [/var/www/cctv]: " APP_DIR
APP_DIR=${APP_DIR:-"/var/www/cctv"}

# Protocol (auto-detect from port)
if [ "$PORT_PUBLIC" = "443" ]; then
    FRONTEND_PROTOCOL="https"
    BACKEND_PROTOCOL="https"
else
    FRONTEND_PROTOCOL="http"
    BACKEND_PROTOCOL="http"
fi

# Generate secrets
print_info "Generating security secrets..."
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || openssl rand -hex 32)
API_KEY_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || openssl rand -hex 32)
CSRF_SECRET=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))" 2>/dev/null || openssl rand -hex 16)

# Generate URLs (primary domain - always without port)
FRONTEND_URL="${FRONTEND_PROTOCOL}://${FRONTEND_DOMAIN}"
BACKEND_URL="${BACKEND_PROTOCOL}://${BACKEND_DOMAIN}"

# ============================================
# GENERATE ALLOWED ORIGINS (HTTP + HTTPS)
# ============================================
ALLOWED_ORIGINS=""

# Function to add domain to ALLOWED_ORIGINS (both HTTP and HTTPS)
add_domain_to_origins() {
    local domain=$1
    local port=$2
    
    # HTTPS without port (always add)
    ALLOWED_ORIGINS="${ALLOWED_ORIGINS},https://${domain}"
    
    # HTTP without port (always add)
    ALLOWED_ORIGINS="${ALLOWED_ORIGINS},http://${domain}"
    
    # With port (if not 80/443)
    if [ "$port" != "80" ] && [ "$port" != "443" ]; then
        ALLOWED_ORIGINS="${ALLOWED_ORIGINS},https://${domain}:${port}"
        ALLOWED_ORIGINS="${ALLOWED_ORIGINS},http://${domain}:${port}"
    fi
}

# Function to add IP to ALLOWED_ORIGINS
add_ip_to_origins() {
    local ip=$1
    local port=$2
    
    # HTTP without port
    ALLOWED_ORIGINS="${ALLOWED_ORIGINS},http://${ip}"
    
    # With port (if not 80/443)
    if [ "$port" != "80" ] && [ "$port" != "443" ]; then
        ALLOWED_ORIGINS="${ALLOWED_ORIGINS},http://${ip}:${port}"
    fi
}

# Add primary frontend domain
add_domain_to_origins "$FRONTEND_DOMAIN" "$PORT_PUBLIC"

# Add additional frontend domains
if [ -n "$ADDITIONAL_FRONTEND_DOMAINS" ]; then
    IFS=',' read -ra FRONTEND_ARRAY <<< "$ADDITIONAL_FRONTEND_DOMAINS"
    for domain in "${FRONTEND_ARRAY[@]}"; do
        domain=$(echo "$domain" | xargs)  # trim whitespace
        if [ -n "$domain" ]; then
            add_domain_to_origins "$domain" "$PORT_PUBLIC"
        fi
    done
fi

# Add primary backend domain
add_domain_to_origins "$BACKEND_DOMAIN" "$PORT_PUBLIC"

# Add additional backend domains
if [ -n "$ADDITIONAL_BACKEND_DOMAINS" ]; then
    IFS=',' read -ra BACKEND_ARRAY <<< "$ADDITIONAL_BACKEND_DOMAINS"
    for domain in "${BACKEND_ARRAY[@]}"; do
        domain=$(echo "$domain" | xargs)
        if [ -n "$domain" ]; then
            add_domain_to_origins "$domain" "$PORT_PUBLIC"
        fi
    done
fi

# Add primary server IP
add_ip_to_origins "$SERVER_IP" "$PORT_PUBLIC"

# Add additional server IPs
if [ -n "$ADDITIONAL_SERVER_IPS" ]; then
    IFS=',' read -ra IP_ARRAY <<< "$ADDITIONAL_SERVER_IPS"
    for ip in "${IP_ARRAY[@]}"; do
        ip=$(echo "$ip" | xargs)
        if [ -n "$ip" ]; then
            add_ip_to_origins "$ip" "$PORT_PUBLIC"
        fi
    done
fi

# Add localhost for development
ALLOWED_ORIGINS="${ALLOWED_ORIGINS},http://localhost:${PORT_BACKEND}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS},http://localhost:5173"

# Remove leading comma
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:1}"

# ============================================
# CONFIRMATION
# ============================================
echo ""
print_header "============================================"
print_header "📋 Configuration Summary"
print_header "============================================"
echo ""
echo "Client:        $CLIENT_NAME ($CLIENT_CODE)"
echo "Frontend URL:  $FRONTEND_URL"
if [ -n "$ADDITIONAL_FRONTEND_DOMAINS" ]; then
    echo "               + Additional: $ADDITIONAL_FRONTEND_DOMAINS"
fi
echo "Backend URL:   $BACKEND_URL"
if [ -n "$ADDITIONAL_BACKEND_DOMAINS" ]; then
    echo "               + Additional: $ADDITIONAL_BACKEND_DOMAINS"
fi
echo "Server IP:     $SERVER_IP"
if [ -n "$ADDITIONAL_SERVER_IPS" ]; then
    echo "               + Additional: $ADDITIONAL_SERVER_IPS"
fi
echo "App Directory: $APP_DIR"
echo ""
echo "Ports:"
echo "  Public:         $PORT_PUBLIC"
echo "  Backend:        $PORT_BACKEND"
echo "  MediaMTX HLS:   $PORT_MEDIAMTX_HLS"
echo "  MediaMTX WebRTC: $PORT_MEDIAMTX_WEBRTC"
echo "  MediaMTX API:   $PORT_MEDIAMTX_API"
echo ""
echo "CORS Origins (HTTP + HTTPS auto-generated):"
echo "  Total origins: $(echo "$ALLOWED_ORIGINS" | tr ',' '\n' | wc -l)"
echo ""
read -p "Continue with installation? [Y/n]: " CONFIRM
CONFIRM=${CONFIRM:-Y}
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    print_info "Installation cancelled"
    exit 0
fi

# ============================================
# GENERATE CLIENT CONFIG
# ============================================
echo ""
print_info "Generating client configuration..."

# Generate config in /tmp first (before cloning repo)
TMP_CONFIG="/tmp/client.config.sh"

cat > "${TMP_CONFIG}" << EOF
#!/bin/bash
# RAF NET CCTV - Client Configuration
# Auto-generated by installer
# Generated: $(date)
# DO NOT EDIT MANUALLY - Regenerate with installer

# Client Information
CLIENT_NAME="$CLIENT_NAME"
CLIENT_CODE="$CLIENT_CODE"

# Domain Configuration
FRONTEND_DOMAIN="$FRONTEND_DOMAIN"
BACKEND_DOMAIN="$BACKEND_DOMAIN"
SERVER_IP="$SERVER_IP"

# Additional Domains/IPs (optional)
ADDITIONAL_FRONTEND_DOMAINS="$ADDITIONAL_FRONTEND_DOMAINS"
ADDITIONAL_BACKEND_DOMAINS="$ADDITIONAL_BACKEND_DOMAINS"
ADDITIONAL_SERVER_IPS="$ADDITIONAL_SERVER_IPS"

# Port Configuration
PORT_PUBLIC="$PORT_PUBLIC"
PORT_BACKEND="$PORT_BACKEND"
PORT_FRONTEND_DEV="5173"
PORT_MEDIAMTX_HLS="$PORT_MEDIAMTX_HLS"
PORT_MEDIAMTX_WEBRTC="$PORT_MEDIAMTX_WEBRTC"
PORT_MEDIAMTX_API="$PORT_MEDIAMTX_API"

# Protocol Configuration
FRONTEND_PROTOCOL="$FRONTEND_PROTOCOL"
BACKEND_PROTOCOL="$BACKEND_PROTOCOL"

# Path Configuration
APP_DIR="$APP_DIR"
DATABASE_PATH="./data/cctv.db"

# Security Configuration
JWT_SECRET="$JWT_SECRET"
API_KEY_SECRET="$API_KEY_SECRET"
CSRF_SECRET="$CSRF_SECRET"

# Generated URLs
FRONTEND_URL="$FRONTEND_URL"
BACKEND_URL="$BACKEND_URL"
ALLOWED_ORIGINS="$ALLOWED_ORIGINS"
PUBLIC_STREAM_BASE_URL="$BACKEND_URL"

# Nginx Configuration
NGINX_PORT="$PORT_PUBLIC"
BACKEND_PORT="$PORT_BACKEND"
MEDIAMTX_HLS_PORT="$PORT_MEDIAMTX_HLS"
MEDIAMTX_WEBRTC_PORT="$PORT_MEDIAMTX_WEBRTC"
MEDIAMTX_API_PORT="$PORT_MEDIAMTX_API"

# Export all variables
export CLIENT_NAME CLIENT_CODE
export FRONTEND_DOMAIN BACKEND_DOMAIN SERVER_IP
export PORT_PUBLIC PORT_BACKEND PORT_FRONTEND_DEV
export PORT_MEDIAMTX_HLS PORT_MEDIAMTX_WEBRTC PORT_MEDIAMTX_API
export FRONTEND_PROTOCOL BACKEND_PROTOCOL
export APP_DIR DATABASE_PATH
export JWT_SECRET API_KEY_SECRET CSRF_SECRET
export FRONTEND_URL BACKEND_URL ALLOWED_ORIGINS PUBLIC_STREAM_BASE_URL
export NGINX_PORT BACKEND_PORT
export MEDIAMTX_HLS_PORT MEDIAMTX_WEBRTC_PORT MEDIAMTX_API_PORT
EOF

chmod +x "${TMP_CONFIG}"
print_success "Client configuration generated"

# Load configuration
source "${TMP_CONFIG}"

# ============================================
# UPDATE SYSTEM
# ============================================
echo ""
print_info "Updating system packages..."
apt update && apt upgrade -y
apt install -y curl wget git build-essential nginx sqlite3 certbot python3-certbot-nginx

# ============================================
# INSTALL NODE.JS
# ============================================
echo ""
print_info "Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
print_success "Node.js $(node --version)"

# ============================================
# INSTALL PM2
# ============================================
echo ""
print_info "Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi
print_success "PM2 $(pm2 --version)"

# ============================================
# INSTALL FFMPEG
# ============================================
echo ""
print_info "Installing FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
    apt install -y ffmpeg
fi
print_success "FFmpeg installed"

# ============================================
# SETUP PROJECT
# ============================================
echo ""
print_info "Setting up project directory..."

if [ -d "$APP_DIR" ]; then
    print_info "Directory exists, backing up..."
    mv "$APP_DIR" "${APP_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
fi

mkdir -p "$APP_DIR"
chown -R $USER:$USER "$APP_DIR"
git clone https://github.com/rafall04/cctv.git "$APP_DIR"
cd "$APP_DIR"

# Copy client config from /tmp to repository
cp "${TMP_CONFIG}" "$APP_DIR/deployment/client.config.sh"

print_success "Repository cloned"

# ============================================
# GENERATE ENVIRONMENT FILES
# ============================================
echo ""
print_info "Generating environment files..."
bash "$APP_DIR/deployment/generate-env.sh"
print_success "Environment files generated"

# ============================================
# SETUP BACKEND
# ============================================
echo ""
print_info "Setting up backend..."
cd "$APP_DIR/backend"

print_info "Installing backend dependencies..."
npm install --production || {
    print_error "Failed to install backend dependencies"
    exit 1
}

print_info "Creating data directory..."
mkdir -p data
chmod 755 data

print_info "Initializing database..."
npm run setup-db || {
    print_error "Failed to initialize database"
    print_info "Check if better-sqlite3 is properly installed"
    exit 1
}

# Migrations already run by setup-db script
# No need to run manually to avoid duplicate execution

mkdir -p "$APP_DIR/recordings"
chmod 755 "$APP_DIR/recordings"

print_success "Backend setup complete"

# ============================================
# SETUP FRONTEND
# ============================================
echo ""
print_info "Setting up frontend..."
cd "$APP_DIR/frontend"
npm install
npm run build
print_success "Frontend built"

# ============================================
# SETUP MEDIAMTX
# ============================================
echo ""
print_info "Setting up MediaMTX..."
cd "$APP_DIR"
mkdir -p mediamtx
cd mediamtx

MEDIAMTX_VERSION="v1.9.0"
wget -q https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz
tar -xzf mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz
rm mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz
chmod +x mediamtx

if [ -f "$APP_DIR/deployment/mediamtx.yml" ]; then
    cp "$APP_DIR/deployment/mediamtx.yml" mediamtx.yml
fi

print_success "MediaMTX configured"

# ============================================
# CONFIGURE NGINX
# ============================================
echo ""
print_info "Configuring Nginx..."

# Generate nginx config
bash "$APP_DIR/deployment/generate-env.sh"

cp "$APP_DIR/deployment/nginx.generated.conf" /etc/nginx/sites-available/${CLIENT_CODE}-cctv
ln -sf /etc/nginx/sites-available/${CLIENT_CODE}-cctv /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl restart nginx

print_success "Nginx configured"

# ============================================
# START SERVICES
# ============================================
echo ""
print_info "Starting services with PM2..."
cd "$APP_DIR"
mkdir -p logs

pm2 delete ${CLIENT_CODE}-cctv-backend 2>/dev/null || true
pm2 delete ${CLIENT_CODE}-mediamtx 2>/dev/null || true

pm2 start deployment/ecosystem.config.cjs
pm2 save
pm2 startup | tail -n 1 | bash || true

print_success "Services started"

# ============================================
# FIREWALL
# ============================================
echo ""
print_info "Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow ${PORT_PUBLIC}/tcp
    ufw allow 443/tcp
    print_success "Firewall configured"
fi

# ============================================
# SUMMARY
# ============================================
echo ""
print_header "============================================"
print_header "✅ Installation Complete!"
print_header "============================================"
echo ""
echo "🌐 Access URLs:"
echo "   Frontend: $FRONTEND_URL"
echo "   Backend:  $BACKEND_URL"
echo ""
echo "🔑 Admin Credentials:"
echo "   Username: admin"
echo "   Password: [Check Telegram]"
echo "   ⚠️  Credentials sent to your Telegram"
echo ""
echo "📊 Service Status:"
pm2 list
echo ""
echo "📝 Next Steps:"
echo "   1. Setup SSL: sudo certbot --nginx"
echo "   2. Generate API Key from admin panel"
echo "   3. Update frontend/.env with API key"
echo "   4. Rebuild frontend: cd $APP_DIR/frontend && npm run build"
echo ""
echo "📁 Important Paths:"
echo "   App:        $APP_DIR"
echo "   Config:     $APP_DIR/deployment/client.config.sh"
echo "   Recordings: $APP_DIR/recordings"
echo "   Database:   $APP_DIR/backend/data/cctv.db"
echo ""
print_header "============================================"
