#!/bin/bash

# RAF NET CCTV - Production Update Script
# This script pulls the latest changes from Git and restarts services.

set -e

echo "🔄 Starting RAF NET CCTV Update..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Navigate to project root (assuming script is in deployment/)
cd "$(dirname "$0")/.."

# 1. Pull latest changes
echo "📥 Pulling latest changes from GitHub..."
git pull origin main

# 2. Update Backend
echo "🛠 Updating Backend..."
cd backend
npm install --omit=dev
cd ..

# 3. Update Frontend
echo "🏗 Updating Frontend..."
cd frontend
npm install
npm run build
cd ..

# 4. Restart Services
echo "🚀 Restarting Services with PM2..."
pm2 restart deployment/ecosystem.config.cjs --env production

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Update Completed Successfully!"
pm2 list
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
