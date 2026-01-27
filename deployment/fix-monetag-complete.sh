#!/bin/bash

# Complete Monetag Fix Script
# Fixes database, backend, and verifies installation

echo "🔧 RAF NET CCTV - Complete Monetag Fix"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Please run as root${NC}"
    exit 1
fi

# Navigate to project directory
cd /var/www/rafnet-cctv || exit 1

echo "📍 Current directory: $(pwd)"
echo ""

# Step 1: Ensure monetag_settings table exists
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Database Migration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd backend || exit 1

if [ -f "database/migrations/ensure_monetag_settings.js" ]; then
    echo "🔄 Running monetag_settings migration..."
    node database/migrations/ensure_monetag_settings.js
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Migration completed successfully${NC}"
    else
        echo -e "${RED}❌ Migration failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Migration file not found${NC}"
    exit 1
fi

echo ""

# Step 2: Verify database structure
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Verify Database"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "🔍 Checking monetag_settings table..."
sqlite3 data/cctv.db "SELECT COUNT(*) as count FROM monetag_settings;" > /tmp/monetag_count.txt 2>&1

if [ $? -eq 0 ]; then
    COUNT=$(cat /tmp/monetag_count.txt)
    echo -e "${GREEN}✅ Table exists with $COUNT row(s)${NC}"
    
    echo ""
    echo "📊 Current settings:"
    sqlite3 data/cctv.db "SELECT 
        popunder_enabled, 
        popunder_zone_id,
        native_banner_enabled,
        native_banner_zone_id
    FROM monetag_settings WHERE id = 1;" 2>&1
else
    echo -e "${RED}❌ Table check failed${NC}"
    exit 1
fi

echo ""

# Step 3: Restart backend
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3: Restart Backend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd /var/www/rafnet-cctv || exit 1

echo "🔄 Restarting PM2 processes..."
pm2 restart rafnet-cctv-backend

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Backend restarted successfully${NC}"
else
    echo -e "${RED}❌ Backend restart failed${NC}"
    exit 1
fi

# Wait for backend to be ready
echo ""
echo "⏳ Waiting for backend to be ready..."
sleep 3

echo ""

# Step 4: Test API endpoints
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4: Test API Endpoints"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "🧪 Testing /api/monetag/config endpoint..."
RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:3000/api/monetag/config)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ API endpoint working (HTTP $HTTP_CODE)${NC}"
    echo ""
    echo "📄 Response:"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}❌ API endpoint failed (HTTP $HTTP_CODE)${NC}"
    echo "Response: $BODY"
    exit 1
fi

echo ""

# Step 5: Check PM2 logs for errors
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 5: Check Backend Logs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "📋 Recent backend logs (last 20 lines):"
pm2 logs rafnet-cctv-backend --lines 20 --nostream

echo ""

# Step 6: Configuration instructions
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 6: Next Steps"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo -e "${YELLOW}⚠️  IMPORTANT: Configure Monetag Zone IDs${NC}"
echo ""
echo "1. Login ke admin panel: https://cctv.raf.my.id/admin/login"
echo "2. Buka menu: Pengaturan Monetag"
echo "3. Masukkan Zone ID dari Monetag dashboard:"
echo "   - Popunder Zone ID"
echo "   - Native Banner Zone ID"
echo "4. Aktifkan format iklan yang diinginkan"
echo "5. Klik 'Simpan Pengaturan'"
echo ""
echo -e "${YELLOW}📝 Cara mendapatkan Zone ID:${NC}"
echo "1. Login ke https://www.monetag.com/"
echo "2. Pilih menu 'Ad Zones' → 'Create Zone'"
echo "3. Pilih format iklan (Popunder, Native Banner, dll)"
echo "4. Copy Zone ID yang diberikan"
echo ""

# Final summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Monetag Fix Completed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Status:"
echo "  ✅ Database migration: OK"
echo "  ✅ Backend restart: OK"
echo "  ✅ API endpoint: OK"
echo ""
echo "⚠️  Iklan belum muncul karena Zone ID masih placeholder"
echo "   Silakan konfigurasi Zone ID di admin panel"
echo ""
