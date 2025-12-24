#!/bin/bash

# RAF NET CCTV - Production Update Script
# This script pulls the latest changes from Git and restarts services.

set -e

echo "🔄 Starting RAF NET CCTV Update..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Pull latest changes
echo "📥 Pulling latest changes from GitHub..."
git pull origin main

# 2. Update Backend
echo "🛠 Updating Backend..."
cd backend
npm install --production
# Run migrations if any (setup-db is safe to run as it uses CREATE TABLE IF NOT EXISTS)
# Note: Be careful if you have destructive changes in setup.js
# npm run setup-db 
cd ..

# 3. Update Frontend
echo "🏗 Updating Frontend..."
cd frontend
npm install
npm run build
cd ..

# 4. Restart Services
echo "🚀 Restarting Services with PM2..."
pm2 restart all

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Update Completed Successfully!"
pm2 list
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
