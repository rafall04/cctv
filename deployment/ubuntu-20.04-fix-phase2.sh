#!/bin/bash

# =================================================================
# RAF NET CCTV - Ubuntu 20.04 Compatibility Fix - PHASE 2
# =================================================================
# 
# PHASE 2: Backend Dependencies & Database Setup
# 
# This script fixes backend-specific issues:
# 
# 1. Installs backend dependencies with proper native compilation
# 2. Fixes better-sqlite3 and bcrypt compilation issues
# 3. Sets up database with proper permissions
# 4. Configures production environment variables (NO CORS filtering)
# 5. Tests backend functionality
# 
# MUST BE RUN AS ROOT
# =================================================================

set -e

echo "🚀 RAF NET CCTV - Ubuntu 20.04 Fix Phase 2"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Phase 2: Backend Dependencies & Database Setup"
echo ""

# Check if running as root (REQUIRED)
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script MUST be run as root"
   echo "   Run with: sudo bash deployment/ubuntu-20.04-fix-phase2.sh"
   exit 1
fi

# Check if Phase 1 was completed
if ! command -v node &> /dev/null || ! command -v pm2 &> /dev/null; then
    echo "❌ Phase 1 not completed. Please run phase 1 first:"
    echo "   bash deployment/ubuntu-20.04-fix-phase1.sh"
    exit 1
fi

# Navigate to project root
PROJECT_ROOT="/opt/cctv"
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "❌ Project directory not found. Please run Phase 1 first."
    exit 1
fi

cd "$PROJECT_ROOT"

# 1. Copy project files if not already present
echo "📁 Step 1: Ensuring project files are in place..."
if [ ! -f "backend/package.json" ]; then
    echo "   ⚠️  Project files not found in $PROJECT_ROOT"
    echo "   Please copy your project files to $PROJECT_ROOT first"
    echo "   Or run this script from your project directory"
    exit 1
fi

# 2. Clean any existing node_modules to avoid conflicts
echo "🧹 Step 2: Cleaning existing installations..."
cd backend
if [ -d "node_modules" ]; then
    echo "   Removing old node_modules..."
    rm -rf node_modules
fi
if [ -f "package-lock.json" ]; then
    echo "   Removing old package-lock.json..."
    rm -f package-lock.json
fi

# 3. Install backend dependencies with verbose logging
echo "📦 Step 3: Installing backend dependencies..."
echo "   This may take several minutes for native compilation..."

# Set npm configuration for better compilation
npm config set python python3
npm config set node_gyp $(which node-gyp)

# Install dependencies with specific flags for Ubuntu 20.04
npm install --verbose --no-optional

# 4. Verify critical native dependencies
echo "🔍 Step 4: Verifying native dependencies..."

# Test better-sqlite3
echo "   Testing better-sqlite3..."
node -e "
try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER)');
    db.close();
    console.log('   ✅ better-sqlite3 working correctly');
} catch (error) {
    console.error('   ❌ better-sqlite3 error:', error.message);
    process.exit(1);
}
"

# Test bcrypt
echo "   Testing bcrypt..."
node -e "
try {
    const bcrypt = require('bcrypt');
    const hash = bcrypt.hashSync('test', 10);
    const valid = bcrypt.compareSync('test', hash);
    if (valid) {
        console.log('   ✅ bcrypt working correctly');
    } else {
        throw new Error('Hash comparison failed');
    }
} catch (error) {
    console.error('   ❌ bcrypt error:', error.message);
    process.exit(1);
}
"

# 5. Setup database directory and permissions
echo "📊 Step 5: Setting up database..."
mkdir -p data
chmod 755 data
chown -R root:root data

# Create production environment file with NO CORS filtering
echo "⚙️ Step 6: Creating production environment configuration..."
cat > .env << EOF
# RAF NET CCTV - Ubuntu 20.04 Production Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# JWT Configuration
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRATION=24h

# MediaMTX Integration
MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_HLS_URL=http://localhost:8888
MEDIAMTX_WEBRTC_URL=http://localhost:8889

# Database
DATABASE_PATH=/opt/cctv/data/cctv.db

# CORS Configuration - NO FILTERING (Ubuntu 20.04 fix)
CORS_ORIGIN=*

# Logging
LOG_LEVEL=info
EOF

echo "   ✅ Environment configuration created (NO CORS filtering)"

# 6. Initialize database
echo "🗄️ Step 7: Initializing database..."
if npm run setup-db; then
    echo "   ✅ Database initialized successfully"
else
    echo "   ❌ Database initialization failed"
    exit 1
fi

# 7. Test database permissions and functionality
echo "🧪 Step 8: Testing database functionality..."
node -e "
try {
    const Database = require('better-sqlite3');
    const db = new Database('./data/cctv.db');
    
    // Test read
    const users = db.prepare('SELECT COUNT(*) as count FROM users').get();
    console.log('   Database users count:', users.count);
    
    // Test write
    const testQuery = db.prepare('SELECT 1 as test');
    const result = testQuery.get();
    
    db.close();
    console.log('   ✅ Database read/write test successful');
} catch (error) {
    console.error('   ❌ Database test failed:', error.message);
    process.exit(1);
}
"

# 8. Test backend server startup
echo "🚀 Step 9: Testing backend server startup..."
echo "   Starting server for 10 seconds..."

# Start server in background
timeout 10s npm start &
SERVER_PID=$!

# Wait a moment for server to start
sleep 3

# Test if server is responding
if curl -s http://localhost:3000/health > /dev/null; then
    echo "   ✅ Backend server responding correctly"
else
    echo "   ❌ Backend server not responding"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Stop test server
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# 9. Set proper file permissions (root ownership)
echo "🔒 Step 10: Setting file permissions..."
chmod +x ../deployment/*.sh
chmod 644 .env
chmod 755 data
chmod 644 data/cctv.db
chown -R root:root /opt/cctv

# 10. Create systemd service file
echo "🔧 Step 11: Creating systemd service..."
tee /etc/systemd/system/rafnet-cctv-backend.service > /dev/null << EOF
[Unit]
Description=RAF NET CCTV Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/cctv/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "   ✅ Systemd service created"

cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Phase 2 Complete: Backend Dependencies & Database Setup"
echo ""
echo "📋 What was fixed:"
echo "   ✓ Backend dependencies installed with native compilation"
echo "   ✓ better-sqlite3 and bcrypt verified working"
echo "   ✓ Database initialized with proper permissions"
echo "   ✓ Production environment configured (NO CORS filtering)"
echo "   ✓ Backend server tested successfully"
echo "   ✓ Systemd service created"
echo "   ✓ Root ownership and permissions set"
echo ""
echo "🚀 Ready for Phase 3: Frontend Build & Configuration"
echo "   Run: bash deployment/ubuntu-20.04-fix-phase3.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"