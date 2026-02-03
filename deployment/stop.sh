#!/bin/bash
# RAF NET CCTV - Stop All Services
# Stops Backend and MediaMTX using PM2

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }

# Load client configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "${SCRIPT_DIR}/client.config.sh" ]; then
    print_error "client.config.sh not found!"
    echo "Please run installation script first:"
    echo "  bash deployment/install.sh"
    echo "  or"
    echo "  bash deployment/aapanel-install.sh"
    exit 1
fi

source "${SCRIPT_DIR}/client.config.sh"

echo "🛑 Stopping RAF NET CCTV Services..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Client: $CLIENT_NAME"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

# Stop services
print_info "Stopping services..."
pm2 stop deployment/ecosystem.config.cjs

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_success "All services have been stopped."
echo ""
echo "📊 Current Status:"
pm2 list | grep ${CLIENT_CODE} || pm2 list
echo ""
echo "💡 Use 'bash deployment/start.sh' to start services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
