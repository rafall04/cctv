#!/bin/bash
# ============================================
# RAF NET CCTV - Quick Deploy Script
# ============================================
# Deploy perubahan setelah edit client.config.sh

set -e

# Load client configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/client.config.sh"

# Detect environment. Only NGINX_CONF_DIR and NGINX_RELOAD are environment-dependent —
# APP_DIR comes from client.config.sh and must not be reassigned here (same reason as
# generate-env.sh: it silently discarded the installer's chosen directory).
if [ -d "/www/server/nginx" ]; then
    echo "🔍 Detected aaPanel environment"
    NGINX_CONF_DIR="/www/server/panel/vhost/nginx"
    NGINX_RELOAD="/etc/init.d/nginx reload"
else
    echo "🔍 Detected standard Ubuntu environment"
    NGINX_CONF_DIR="/etc/nginx/sites-available"
    NGINX_RELOAD="systemctl reload nginx"
fi

# Fall back only when client.config.sh did not provide one.
APP_DIR="${APP_DIR:-/var/www/cctv}"

echo "============================================"
echo "RAF NET CCTV - Quick Deploy"
echo "============================================"
echo "Client: $CLIENT_NAME"
echo ""

# 1. Generate environment files
echo "📝 Step 1: Generating environment files..."
bash "${SCRIPT_DIR}/generate-env.sh"
echo ""

# 2. Copy nginx config
echo "📝 Step 2: Copying nginx config..."
if [ -d "/www/server/nginx" ]; then
    cp "${APP_DIR}/deployment/nginx.generated.conf" "${NGINX_CONF_DIR}/${CLIENT_CODE}-cctv.conf"
    echo "✅ Nginx config copied to: ${NGINX_CONF_DIR}/${CLIENT_CODE}-cctv.conf"
else
    cp "${APP_DIR}/deployment/nginx.generated.conf" "${NGINX_CONF_DIR}/${CLIENT_CODE}-cctv"
    ln -sf "${NGINX_CONF_DIR}/${CLIENT_CODE}-cctv" /etc/nginx/sites-enabled/
    echo "✅ Nginx config copied and linked"
fi
echo ""

# 3. Test nginx
echo "📝 Step 3: Testing nginx config..."
nginx -t
echo ""

# 4. Reload nginx
echo "📝 Step 4: Reloading nginx..."
eval $NGINX_RELOAD
echo "✅ Nginx reloaded"
echo ""

# 5. Rebuild frontend
echo "📝 Step 5: Rebuilding frontend..."
cd "${APP_DIR}/frontend"
npm run build
echo "✅ Frontend rebuilt"
echo ""

# 6. Restart backend
echo "📝 Step 6: Restarting backend..."
pm2 restart ${CLIENT_CODE}-cctv-backend
echo "✅ Backend restarted"
echo ""

# 7. Show status
echo "📊 Service Status:"
pm2 list | grep ${CLIENT_CODE}
echo ""

echo "============================================"
echo "✅ Deployment Complete!"
echo "============================================"
echo ""
echo "🌐 Access URLs:"
echo "  Frontend: ${FRONTEND_URL}"
echo "  Backend:  ${BACKEND_URL}"
echo "  IP:       http://${SERVER_IP}:${NGINX_PORT}"
echo ""
echo "⚠️  Don't forget to:"
echo "  1. Update secrets in backend/.env"
echo "  2. Generate API key from admin panel"
echo "  3. Update VITE_API_KEY in frontend/.env"
echo "============================================"
