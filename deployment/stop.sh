#!/bin/bash

# RAF NET CCTV - Stop All Services
# This script stops all managed services.

set -e

echo "🛑 Stopping RAF NET CCTV Services..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Navigate to project root
cd "$(dirname "$0")/.."

# Stop everything defined in the ecosystem config
pm2 stop deployment/ecosystem.config.cjs

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All services have been stopped."
pm2 list
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
