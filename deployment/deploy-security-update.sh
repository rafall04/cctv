#!/bin/bash
# =============================================
# RAF NET CCTV - Security Update Deployment
# Run as root: bash deploy-security-update.sh
# =============================================
set -e

echo "🔒 RAF NET CCTV - Security Update"
echo "=================================="

# Check root
if [[ $EUID -ne 0 ]]; then
   echo "❌ Jalankan sebagai root!"
   exit 1
fi

PROJECT_ROOT="/var/www/rafnet-cctv"
cd "$PROJECT_ROOT"

# Step 1: Pull latest code
echo ""
echo "📥 Step 1: Pull latest code..."
git pull origin main

# Step 2: Backend update
echo ""
echo "📦 Step 2: Update backend..."
cd backend
npm install --production --silent

# Step 3: Run security migration
echo ""
echo "🗄️ Step 3: Run database migration..."
node database/migrate_security.js 2>/dev/null || echo "Migration already done or skipped"

# Step 4: Generate secrets if not exist
echo ""
echo "🔑 Step 4: Check security secrets..."
if ! grep -q "API_KEY_SECRET=" .env 2>/dev/null || grep -q "CHANGE_THIS" .env 2>/dev/null; then
    echo "   Generating new secrets..."
    
    API_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    CSRF_SECRET=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
    
    # Append to .env if not exist
    grep -q "API_KEY_SECRET=" .env || echo "API_KEY_SECRET=$API_SECRET" >> .env
    grep -q "CSRF_SECRET=" .env || echo "CSRF_SECRET=$CSRF_SECRET" >> .env
    grep -q "API_KEY_VALIDATION_ENABLED=" .env || echo "API_KEY_VALIDATION_ENABLED=true" >> .env
    grep -q "CSRF_ENABLED=" .env || echo "CSRF_ENABLED=true" >> .env
    grep -q "RATE_LIMIT_ENABLED=" .env || echo "RATE_LIMIT_ENABLED=true" >> .env
    grep -q "BRUTE_FORCE_ENABLED=" .env || echo "BRUTE_FORCE_ENABLED=true" >> .env
    
    echo "   ✅ Secrets generated"
else
    echo "   ✅ Secrets already configured"
fi

# Step 5: Generate API key for frontend
echo ""
echo "🔐 Step 5: Generate frontend API key..."
API_KEY=$(node -e "
import('./services/apiKeyService.js').then(m => {
    const key = m.generateApiKey();
    try { m.storeApiKey(key, 'Frontend-Auto', 1); } catch(e) {}
    console.log(key);
}).catch(() => console.log('SKIP'));
" 2>/dev/null || echo "SKIP")

if [ "$API_KEY" != "SKIP" ] && [ -n "$API_KEY" ]; then
    echo "   API Key: $API_KEY"
    echo "   ⚠️  SIMPAN API KEY INI untuk frontend/.env"
fi

# Step 6: Frontend build
echo ""
echo "🎨 Step 6: Build frontend..."
cd ../frontend
npm install --silent
npm run build

# Step 7: Restart services
echo ""
echo "🔄 Step 7: Restart services..."
cd "$PROJECT_ROOT"
pm2 restart rafnet-cctv-backend || pm2 restart all

# Step 8: Verify
echo ""
echo "✅ Step 8: Verify deployment..."
sleep 3
curl -s http://localhost:3000/health | head -c 200
echo ""

echo ""
echo "=================================="
echo "✅ DEPLOYMENT COMPLETE!"
echo ""
echo "⚠️  PENTING:"
echo "   1. Update frontend/.env dengan VITE_API_KEY"
echo "   2. Rebuild frontend jika API key berubah"
echo "   3. Test login di https://cctv.raf.my.id/admin/login"
echo "=================================="
