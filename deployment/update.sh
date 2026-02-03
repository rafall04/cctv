#!/bin/bash
# RAF NET CCTV - Update Script
# Updates application from Git repository

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }

# Load client configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "${SCRIPT_DIR}/client.config.sh" ]; then
    echo "❌ Error: client.config.sh not found!"
    echo "Please run installation script first:"
    echo "  bash deployment/install.sh"
    echo "  or"
    echo "  bash deployment/aapanel-install.sh"
    exit 1
fi

source "${SCRIPT_DIR}/client.config.sh"

echo "🔄 RAF NET CCTV - Update"
echo "========================"
echo "Client: $CLIENT_NAME"
echo ""

cd "$APP_DIR"

# Pull latest code
print_info "Pulling latest code..."
git pull origin main

# Update backend
print_info "Updating backend..."
cd backend
npm install --production

# Run migrations
print_info "Running migrations..."
if [ -d "database/migrations" ]; then
    for migration in database/migrations/*.js; do
        if [ -f "$migration" ]; then
            node "$migration" || true
        fi
    done
fi

# Update frontend
print_info "Building frontend..."
cd ../frontend
npm install
npm run build

# Restart services
print_info "Restarting services..."
pm2 restart ${CLIENT_CODE}-cctv-backend
pm2 restart ${CLIENT_CODE}-mediamtx 2>/dev/null || true

# Reload web server
print_info "Reloading web server..."
if command -v nginx &> /dev/null; then
    nginx -t && systemctl reload nginx
elif command -v apache2 &> /dev/null; then
    apache2ctl -t && systemctl reload apache2
fi

echo ""
print_success "Update completed!"
echo ""
pm2 list | grep ${CLIENT_CODE} || pm2 list
