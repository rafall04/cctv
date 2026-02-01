#!/bin/bash
# RAF NET CCTV - aaPanel Quick Install Script
# Run as root: bash aapanel-install.sh

set -e

echo "🚀 RAF CCTV - aaPanel Installation"
echo "========================================"

# Configuration
APP_DIR="/var/www/rafnet-cctv"
REPO_URL="https://github.com/rafall04/cctv.git"
DOMAIN_FRONTEND="sicamdes.semarnet.id"
DOMAIN_BACKEND="api-sicamdes.semarnet.id"
PORT=800

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then 
        print_error "Please run as root"
        exit 1
    fi
    print_success "Running as root"
}

check_dependencies() {
    echo ""
    echo "📋 Checking dependencies..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js not found. Installing..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt install -y nodejs
    fi
    NODE_VERSION=$(node --version)
    print_success "Node.js $NODE_VERSION"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm not found"
        exit 1
    fi
    NPM_VERSION=$(npm --version)
    print_success "npm $NPM_VERSION"
    
    # Check PM2
    if ! command -v pm2 &> /dev/null; then
        print_info "Installing PM2..."
        npm install -g pm2
    fi
    PM2_VERSION=$(pm2 --version)
    print_success "PM2 $PM2_VERSION"
    
    # Check Nginx
    if ! command -v nginx &> /dev/null; then
        print_error "Nginx not found. Please install via aaPanel first."
        exit 1
    fi
    print_success "Nginx installed"
    
    # Check Git
    if ! command -v git &> /dev/null; then
        print_info "Installing Git..."
        apt install -y git
    fi
    print_success "Git installed"
    
    # Check FFmpeg (CRITICAL for recording)
    if ! command -v ffmpeg &> /dev/null; then
        print_info "Installing FFmpeg..."
        apt update
        apt install -y ffmpeg
    fi
    FFMPEG_VERSION=$(ffmpeg -version | head -n1 | cut -d' ' -f3)
    print_success "FFmpeg $FFMPEG_VERSION"
    
    # Check ffprobe (comes with FFmpeg)
    if ! command -v ffprobe &> /dev/null; then
        print_error "ffprobe not found (should come with FFmpeg)"
        exit 1
    fi
    print_success "ffprobe installed"
}

clone_repository() {
    echo ""
    echo "📥 Cloning repository..."
    
    if [ -d "$APP_DIR" ]; then
        print_info "Directory exists. Backing up..."
        mv "$APP_DIR" "${APP_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    mkdir -p "$APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
    print_success "Repository cloned"
}

setup_backend() {
    echo ""
    echo "🔧 Setting up backend..."
    
    cd "$APP_DIR/backend"
    
    # Install dependencies
    print_info "Installing dependencies..."
    npm install --production
    
    # Setup .env
    if [ ! -f .env ]; then
        print_info "Creating .env file..."
        cp .env.example .env
        
        # Generate secrets
        JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        CSRF_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        
        # Update .env
        sed -i "s|NODE_ENV=.*|NODE_ENV=production|g" .env
        sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|g" .env
        sed -i "s|CSRF_SECRET=.*|CSRF_SECRET=$CSRF_SECRET|g" .env
        sed -i "s|ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://$DOMAIN_FRONTEND,http://$DOMAIN_FRONTEND,http://172.17.11.12|g" .env
        
        print_success ".env configured"
    else
        print_info ".env already exists, skipping"
    fi
    
    # Setup database
    print_info "Initializing database..."
    mkdir -p data
    npm run setup-db
    print_success "Database initialized"
    
    # Setup recordings directory (CRITICAL for recording feature)
    print_info "Creating recordings directory..."
    mkdir -p "$APP_DIR/recordings"
    chmod 755 "$APP_DIR/recordings"
    print_success "Recordings directory created: $APP_DIR/recordings"
}

setup_frontend() {
    echo ""
    echo "🎨 Setting up frontend..."
    
    cd "$APP_DIR/frontend"
    
    # Install dependencies
    print_info "Installing dependencies..."
    npm install
    
    # Setup .env
    print_info "Creating .env file..."
    cat > .env << EOF
VITE_API_BASE_URL=https://$DOMAIN_BACKEND
VITE_HLS_BASE_URL=https://$DOMAIN_BACKEND/hls
EOF
    
    # Build
    print_info "Building frontend..."
    npm run build
    print_success "Frontend built"
}

setup_mediamtx() {
    echo ""
    echo "📡 Setting up MediaMTX..."
    
    cd "$APP_DIR/mediamtx"
    
    # Download MediaMTX
    if [ ! -f mediamtx ]; then
        print_info "Downloading MediaMTX..."
        wget -q https://github.com/bluenviron/mediamtx/releases/download/v1.9.0/mediamtx_v1.9.0_linux_amd64.tar.gz
        tar -xzf mediamtx_v1.9.0_linux_amd64.tar.gz
        rm mediamtx_v1.9.0_linux_amd64.tar.gz
        chmod +x mediamtx
        print_success "MediaMTX downloaded"
    else
        print_info "MediaMTX already exists"
    fi
    
    # Verify config
    if [ ! -f mediamtx.yml ]; then
        print_error "mediamtx.yml not found!"
        exit 1
    fi
    print_success "MediaMTX configured"
}

setup_pm2() {
    echo ""
    echo "⚙️ Setting up PM2..."
    
    cd "$APP_DIR"
    
    # Create logs directory
    mkdir -p logs
    
    # Stop existing processes
    pm2 delete rafnet-cctv-backend 2>/dev/null || true
    pm2 delete rafnet-cctv-mediamtx 2>/dev/null || true
    
    # Start processes
    print_info "Starting PM2 processes..."
    pm2 start deployment/ecosystem.config.cjs
    
    # Save and setup startup
    pm2 save
    pm2 startup | tail -n 1 | bash
    
    print_success "PM2 configured"
}

setup_nginx() {
    echo ""
    echo "🌐 Setting up Nginx..."
    
    NGINX_CONF="/etc/nginx/sites-available/rafnet-cctv"
    
    # Backup existing config
    if [ -f "$NGINX_CONF" ]; then
        print_info "Backing up existing config..."
        cp "$NGINX_CONF" "${NGINX_CONF}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Copy new config
    print_info "Installing Nginx config..."
    cp "$APP_DIR/deployment/nginx.conf" "$NGINX_CONF"
    
    # Enable site
    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/rafnet-cctv
    
    # Test config
    if nginx -t 2>/dev/null; then
        print_success "Nginx config valid"
        systemctl reload nginx
        print_success "Nginx reloaded"
    else
        print_error "Nginx config invalid!"
        exit 1
    fi
}

setup_firewall() {
    echo ""
    echo "🔥 Configuring firewall..."
    
    if command -v ufw &> /dev/null; then
        ufw allow $PORT/tcp 2>/dev/null || true
        print_success "Firewall configured (port $PORT)"
    else
        print_info "UFW not found, skipping firewall config"
    fi
}

verify_installation() {
    echo ""
    echo "🔍 Verifying installation..."
    
    # Check PM2
    if pm2 list | grep -q "rafnet-cctv-backend.*online"; then
        print_success "Backend running"
    else
        print_error "Backend not running"
    fi
    
    if pm2 list | grep -q "rafnet-cctv-mediamtx.*online"; then
        print_success "MediaMTX running"
    else
        print_error "MediaMTX not running"
    fi
    
    # Check Nginx
    if systemctl is-active --quiet nginx; then
        print_success "Nginx running"
    else
        print_error "Nginx not running"
    fi
    
    # Check backend health
    sleep 2
    if curl -s http://localhost:3000/health | grep -q "ok"; then
        print_success "Backend health check passed"
    else
        print_error "Backend health check failed"
    fi
    
    # Check MediaMTX
    if curl -s http://localhost:9997/v3/config/global/get | grep -q "logLevel"; then
        print_success "MediaMTX API responding"
    else
        print_error "MediaMTX API not responding"
    fi
}

print_summary() {
    echo ""
    echo "========================================"
    echo "✅ Installation Complete!"
    echo "========================================"
    echo ""
    echo "📍 Access URLs:"
    echo "   Frontend: http://$DOMAIN_FRONTEND:$PORT"
    echo "   Backend:  http://$DOMAIN_BACKEND:$PORT"
    echo ""
    echo "🔑 Default Credentials:"
    echo "   Username: admin"
    echo "   Password: admin123"
    echo "   ⚠️  CHANGE PASSWORD IMMEDIATELY!"
    echo ""
    echo "📊 Management Commands:"
    echo "   PM2 status:  pm2 status"
    echo "   PM2 logs:    pm2 logs rafnet-cctv-backend"
    echo "   Nginx test:  nginx -t"
    echo "   Nginx reload: systemctl reload nginx"
    echo ""
    echo "🔄 Update Command:"
    echo "   cd $APP_DIR && ./deployment/update.sh"
    echo ""
    echo "📝 Next Steps:"
    echo "   1. Change admin password"
    echo "   2. Add cameras via admin panel"
    echo "   3. Test video streaming"
    echo "   4. Enable recording for cameras"
    echo "   5. Setup backup cron job"
    echo ""
    echo "📁 Important Paths:"
    echo "   App:        $APP_DIR"
    echo "   Recordings: $APP_DIR/recordings"
    echo "   Database:   $APP_DIR/backend/data/cctv.db"
    echo "   Logs:       $APP_DIR/logs"
    echo ""
    echo "⚠️  Recording Notes:"
    echo "   - Recordings stored in: $APP_DIR/recordings/camera{id}/"
    echo "   - Each segment is ~10 minutes (600s)"
    echo "   - Auto-cleanup based on retention period"
    echo "   - Requires FFmpeg (already installed)"
    echo ""
}

# Main execution
main() {
    check_root
    check_dependencies
    clone_repository
    setup_backend
    setup_frontend
    setup_mediamtx
    setup_pm2
    setup_nginx
    setup_firewall
    verify_installation
    print_summary
}

# Run main function
main
