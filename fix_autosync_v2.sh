#!/bin/bash
# =================================================================
#
# Title: fix_autosync_v2.sh
#
# Description: This script restarts the backend services to apply
#              the new auto-sync logic that has been integrated
#              directly into the backend code.
#
# Actions:
#   1. Stops all PM2 managed processes.
#   2. Restarts all services via the PM2 ecosystem file.
#
# =================================================================

set -e # Exit immediately if a command exits with a non-zero status.

echo "🚀 Restarting services to apply new auto-sync logic..."

echo "🛑 Stopping all PM2 services..."
pm2 stop all || echo "PM2 not running."

echo "♻️ Starting all services with PM2..."
pm2 flush
pm2 start deployment/ecosystem.config.cjs

sleep 2
pm2 status

echo "✅ Services restarted. Auto-sync feature is now active."
