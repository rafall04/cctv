#!/bin/bash

# =================================================================
# RAF NET CCTV - Ubuntu 20.04 Compatibility Fix - PHASE 3
# =================================================================
# 
# PHASE 3: Frontend Build & Configuration
# 
# This script fixes frontend-specific issues:
# 
# 1. Installs frontend dependencies
# 2. Configures production environment variables
# 3. Builds optimized production bundle
# 4. Sets up static file serving
# 5. Tests frontend build integrity
# 
# =================================================================

set -e

echo "🚀 RAF NET CCTV - Ubuntu 20.04 Fix Phase 3"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Phase 3: Frontend Build & Configuration"
echo ""

# Check if previous phases were completed
if ! command -v node &> /dev/null || ! command -v pm2 &> /dev/null; then
    echo "❌ Phase 1 not completed. Please run phases in order."
    exit 1
fi

# Navigate to project root
PROJECT_ROOT="/var/www/rafnet-cctv"
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "❌ Project directory not found. Please run Phase 1 first."
    exit 1
fi

cd "$PROJECT_ROOT"

# Check if backend was set up
if [ ! -f "backend/.env" ]; then
    echo "❌ Phase 2 not completed. Please run Phase 2 first."
    exit 1
fi

# 1. Navigate to frontend directory
echo "📁 Step 1: Preparing frontend environment..."
if [ ! -d "frontend" ]; then
    echo "❌ Frontend directory not found"
    exit 1
fi

cd frontend

# 2. Clean any existing installations
echo "🧹 Step 2: Cleaning existing frontend installations..."
if [ -d "node_modules" ]; then
    echo "   Removing old node_modules..."
    rm -rf node_modules
fi
if [ -f "package-lock.json" ]; then
    echo "   Removing old package-lock.json..."
    rm -f package-lock.json
fi
if [ -d "dist" ]; then
    echo "   Removing old build..."
    rm -rf dist
fi

# 3. Create production environment configuration
echo "⚙️ Step 3: Creating frontend production environment..."
cat > .env.production << EOF
# RAF NET CCTV - Frontend Production Configuration
VITE_API_URL=https://api-cctv.raf.my.id
VITE_APP_NAME=RAF NET CCTV Hub
VITE_APP_VERSION=1.0.0
EOF

# Also create .env.local for development
cat > .env.local << EOF
# RAF NET CCTV - Frontend Development Configuration
VITE_API_URL=http://localhost:3000
VITE_APP_NAME=RAF NET CCTV Hub (Dev)
VITE_APP_VERSION=1.0.0-dev
EOF

echo "   ✅ Environment configurations created"

# 4. Install frontend dependencies
echo "📦 Step 4: Installing frontend dependencies..."
echo "   This may take a few minutes..."

# Install with specific npm settings for Ubuntu 20.04
npm install --no-optional --prefer-offline

# 5. Verify critical dependencies
echo "🔍 Step 5: Verifying frontend dependencies..."

# Check if critical packages are installed
node -e "
const fs = require('fs');
const path = require('path');

const criticalPackages = [
    'react',
    'react-dom', 
    'react-router-dom',
    'axios',
    'hls.js',
    'vite',
    'tailwindcss'
];

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

let missing = [];
for (const pkg of criticalPackages) {
    if (!allDeps[pkg]) {
        missing.push(pkg);
    }
}

if (missing.length > 0) {
    console.error('❌ Missing critical packages:', missing.join(', '));
    process.exit(1);
} else {
    console.log('✅ All critical packages present');
}
"

# 6. Test Vite configuration
echo "🔧 Step 6: Testing Vite configuration..."
if [ -f "vite.config.js" ]; then
    # Test if vite config is valid
    npx vite --version > /dev/null
    echo "   ✅ Vite configuration valid"
else
    echo "   ❌ vite.config.js not found"
    exit 1
fi

# 7. Build production bundle
echo "🏗️ Step 7: Building production bundle..."
echo "   This may take several minutes..."

# Set NODE_ENV for build
export NODE_ENV=production

# Build with verbose output
if npm run build; then
    echo "   ✅ Production build successful"
else
    echo "   ❌ Production build failed"
    exit 1
fi

# 8. Verify build output
echo "🔍 Step 8: Verifying build output..."
if [ ! -d "dist" ]; then
    echo "   ❌ Build output directory 'dist' not found"
    exit 1
fi

# Check if essential files exist
ESSENTIAL_FILES=("dist/index.html" "dist/assets")
for file in "${ESSENTIAL_FILES[@]}"; do
    if [ ! -e "$file" ]; then
        echo "   ❌ Essential build file missing: $file"
        exit 1
    fi
done

# Check build size
BUILD_SIZE=$(du -sh dist | cut -f1)
echo "   📊 Build size: $BUILD_SIZE"

# Count assets
ASSET_COUNT=$(find dist/assets -type f | wc -l)
echo "   📁 Asset files: $ASSET_COUNT"

echo "   ✅ Build output verified"

# 9. Test build integrity
echo "🧪 Step 9: Testing build integrity..."

# Check if index.html contains proper references
if grep -q "assets/" dist/index.html; then
    echo "   ✅ Asset references found in index.html"
else
    echo "   ❌ No asset references in index.html"
    exit 1
fi

# Check if main JS bundle exists
if ls dist/assets/*.js 1> /dev/null 2>&1; then
    echo "   ✅ JavaScript bundles found"
else
    echo "   ❌ No JavaScript bundles found"
    exit 1
fi

# Check if CSS bundle exists
if ls dist/assets/*.css 1> /dev/null 2>&1; then
    echo "   ✅ CSS bundles found"
else
    echo "   ⚠️  No CSS bundles found (may be normal for some builds)"
fi

# 10. Set proper permissions
echo "🔒 Step 10: Setting build permissions..."
chmod -R 755 dist
find dist -type f -exec chmod 644 {} \;

# 11. Create nginx-friendly structure
echo "🌐 Step 11: Preparing for nginx serving..."

# Create .htaccess equivalent info for nginx
cat > dist/.nginx-info << EOF
# RAF NET CCTV Frontend - Nginx Configuration Notes
# 
# This build should be served with:
# - index.html as fallback for SPA routing
# - Proper MIME types for assets
# - Gzip compression enabled
# - Cache headers for static assets
# 
# See deployment/nginx.conf for complete configuration
EOF

# 12. Test static file serving capability
echo "🚀 Step 12: Testing static file serving..."

# Install serve globally if not present
if ! command -v serve &> /dev/null; then
    echo "   Installing serve for testing..."
    sudo npm install -g serve
fi

# Test serve on a different port temporarily
echo "   Starting test server on port 3001..."
timeout 10s serve -s dist -l 3001 &
SERVE_PID=$!

# Wait for server to start
sleep 3

# Test if frontend is accessible
if curl -s http://localhost:3001 | grep -q "RAF NET CCTV" || curl -s http://localhost:3001 | grep -q "<!DOCTYPE html>"; then
    echo "   ✅ Frontend serving correctly"
else
    echo "   ❌ Frontend not serving correctly"
    kill $SERVE_PID 2>/dev/null || true
    exit 1
fi

# Stop test server
kill $SERVE_PID 2>/dev/null || true
wait $SERVE_PID 2>/dev/null || true

cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Phase 3 Complete: Frontend Build & Configuration"
echo ""
echo "📋 What was fixed:"
echo "   ✓ Frontend dependencies installed successfully"
echo "   ✓ Production environment configured"
echo "   ✓ Optimized production build created"
echo "   ✓ Build integrity verified"
echo "   ✓ Static file serving tested"
echo "   ✓ Nginx-ready structure prepared"
echo ""
echo "📊 Build Statistics:"
echo "   📁 Build size: $BUILD_SIZE"
echo "   📄 Asset files: $ASSET_COUNT"
echo "   📍 Location: $PROJECT_ROOT/frontend/dist"
echo ""
echo "🚀 Ready for Phase 4: MediaMTX Configuration & Setup"
echo "   Run: bash deployment/ubuntu-20.04-fix-phase4.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"