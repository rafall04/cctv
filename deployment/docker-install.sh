#!/bin/bash
# RAF NET CCTV - Docker Quick Install Script
# Supports: Ubuntu 20.04+, Debian 11+, CentOS 8+

set -e

echo "🐳 RAF NET CCTV - Docker Installation"
echo "========================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }

# Check root
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run as root: sudo bash docker-install.sh"
    exit 1
fi

# 1. Install Docker
echo ""
echo "📦 Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    print_success "Docker installed"
else
    print_info "Docker already installed"
fi

# 2. Install Docker Compose
echo ""
echo "📦 Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
    curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    print_success "Docker Compose installed"
else
    print_info "Docker Compose already installed"
fi

# 3. Setup project directory
echo ""
echo "📁 Setting up project..."
APP_DIR="/var/www/rafnet-cctv"
REPO_URL="https://github.com/rafall04/cctv.git"

if [ -d "$APP_DIR" ]; then
    print_info "Directory exists. Backing up..."
    mv "$APP_DIR" "${APP_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
fi

mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Clone repository
print_info "Cloning repository..."
git clone "$REPO_URL" .
print_success "Repository cloned"

# 4. Generate environment files
echo ""
echo "🔧 Generating environment files..."

# Backend .env
cat > backend/.env << 'EOF'
# ===================================
# Domain Configuration
# ===================================
BACKEND_DOMAIN=localhost
FRONTEND_DOMAIN=localhost
SERVER_IP=127.0.0.1
PORT_PUBLIC=800

# ===================================
# Public Stream URLs
# ===================================
PUBLIC_STREAM_BASE_URL=http://localhost:800
PUBLIC_HLS_PATH=/hls
PUBLIC_WEBRTC_PATH=/webrtc

# ===================================
# Security Secrets (CHANGE IN PRODUCTION!)
# ===================================
EOF

# Generate secrets
JWT_SECRET=$(openssl rand -hex 32)
API_KEY_SECRET=$(openssl rand -hex 32)
CSRF_SECRET=$(openssl rand -hex 16)

cat >> backend/.env << EOF
JWT_SECRET=$JWT_SECRET
API_KEY_SECRET=$API_KEY_SECRET
CSRF_SECRET=$CSRF_SECRET

# ===================================
# CORS (auto-generated)
# ===================================
ALLOWED_ORIGINS=

# ===================================
# MediaMTX (Docker internal)
# ===================================
MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_HLS_URL_INTERNAL=http://localhost:8888
MEDIAMTX_WEBRTC_URL_INTERNAL=http://localhost:8889

# ===================================
# Other Settings
# ===================================
PORT=3000
NODE_ENV=production
DATABASE_PATH=./data/cctv.db
EOF

print_success "Backend .env created"

# Frontend .env
cat > frontend/.env << 'EOF'
# Backend API URL
VITE_API_URL=http://localhost:800

# Frontend Domain
VITE_FRONTEND_DOMAIN=localhost
EOF

print_success "Frontend .env created"

# 5. Create necessary directories
echo ""
echo "📁 Creating directories..."
mkdir -p backend/data recordings logs ssl
chmod 755 recordings
print_success "Directories created"

# 6. Build and start containers
echo ""
echo "🚀 Building Docker images..."
docker-compose build

echo ""
echo "🚀 Starting containers..."
docker-compose up -d

# 7. Wait for backend to be ready
echo ""
echo "⏳ Waiting for backend to initialize..."
sleep 10

# Initialize database
print_info "Initializing database..."
docker-compose exec -T cctv-app sh -c "cd backend && npm run setup-db"

# Run migrations
print_info "Running migrations..."
docker-compose exec -T cctv-app sh -c "cd backend/database/migrations && for f in *.js; do node \$f; done"

print_success "Database initialized"

# 8. Verify installation
echo ""
echo "🔍 Verifying installation..."

if docker-compose ps | grep -q "Up"; then
    print_success "Containers running"
else
    print_error "Containers not running"
    docker-compose logs --tail=50
    exit 1
fi

# Check backend health
sleep 5
if curl -s http://localhost:3000/health | grep -q "ok"; then
    print_success "Backend health check passed"
else
    print_error "Backend health check failed"
fi

# 9. Print summary
echo ""
echo "========================================"
echo "✅ Installation Complete!"
echo "========================================"
echo ""
echo "📍 Access URLs:"
echo "   Frontend: http://localhost:800"
echo "   Backend:  http://localhost:800/api"
echo "   MediaMTX: http://localhost:9997"
echo ""
echo "🔑 Default Credentials:"
echo "   Username: admin"
echo "   Password: admin123"
echo "   ⚠️  CHANGE PASSWORD IMMEDIATELY!"
echo ""
echo "📊 Docker Commands:"
echo "   Status:   docker-compose ps"
echo "   Logs:     docker-compose logs -f"
echo "   Stop:     docker-compose stop"
echo "   Start:    docker-compose start"
echo "   Restart:  docker-compose restart"
echo "   Rebuild:  docker-compose up -d --build"
echo ""
echo "🔄 Update Command:"
echo "   cd $APP_DIR"
echo "   git pull origin main"
echo "   docker-compose up -d --build"
echo ""
echo "📝 Next Steps:"
echo "   1. Change admin password"
echo "   2. Update domains in backend/.env and frontend/.env"
echo "   3. Rebuild: docker-compose up -d --build"
echo "   4. Generate API key from admin panel"
echo "   5. Add cameras via admin panel"
echo ""
echo "📁 Important Paths:"
echo "   App:        $APP_DIR"
echo "   Recordings: $APP_DIR/recordings"
echo "   Database:   $APP_DIR/backend/data/cctv.db"
echo "   Logs:       $APP_DIR/logs"
echo ""
echo "🔧 Configuration Files:"
echo "   Backend:  $APP_DIR/backend/.env"
echo "   Frontend: $APP_DIR/frontend/.env"
echo "   MediaMTX: $APP_DIR/mediamtx/mediamtx.yml"
echo ""
