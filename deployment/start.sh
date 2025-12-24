#!/bin/bash

# RAF NET CCTV - Start All Services
# This script starts the Backend, Frontend, and MediaMTX using PM2.

set -e

echo "🚀 Starting RAF NET CCTV Services..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Navigate to project root (assuming script is in deployment/)
cd "$(dirname "$0")/.."

# Start everything using the ecosystem config
pm2 start deployment/ecosystem.config.cjs --env production

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All services are starting!"
echo "📊 Current Status:"
pm2 list
echo ""
echo "💡 Use 'pm2 logs' to see real-time output."
echo "💡 Use 'pm2 stop all' to stop everything."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
