# aaPanel Apache Configuration Guide

## ⚠️ IMPORTANT

Jika aaPanel tidak mengizinkan install Nginx karena sudah ada Apache, **gunakan Apache sebagai reverse proxy**. Apache bisa melakukan semua yang Nginx lakukan!

## 📋 Prerequisites

- aaPanel installed
- Apache2 running
- Domain sudah pointing ke server IP:
  - `sicamdes.semarnet.id` → Server IP
  - `api-sicamdes.semarnet.id` → Server IP
- Application installed di `/var/www/cctv`
- Backend running di `localhost:3001`
- MediaMTX running di `localhost:8888`

## 🔧 Enable Required Apache Modules

Apache membutuhkan beberapa modules untuk reverse proxy:

```bash
# Enable required modules
a2enmod proxy
a2enmod proxy_http
a2enmod proxy_wstunnel
a2enmod headers
a2enmod rewrite

# Restart Apache
systemctl restart apache2
```

**Verify:**
```bash
apache2ctl -M | grep proxy
# Should show:
#  proxy_module (shared)
#  proxy_http_module (shared)
#  proxy_wstunnel_module (shared)
```

## 🌐 Setup via aaPanel UI

### Step 1: Add Frontend Site

1. **Login to aaPanel**
   - URL: `http://YOUR_SERVER_IP:7800`

2. **Go to Website Menu**
   - Click "Website" di sidebar
   - Click "Add site" button

3. **Configure Frontend Site**
   ```
   Domain: sicamdes.semarnet.id
   Port: 800
   Root Directory: /var/www/cctv/frontend/dist
   PHP Version: Pure static (no PHP needed)
   Database: None
   FTP: No
   ```

4. **Click "Submit"**

### Step 2: Add Backend Site

1. **Add Another Site**
   - Click "Add site" button again

2. **Configure Backend Site**
   ```
   Domain: api-sicamdes.semarnet.id
   Port: 800
   Root Directory: /var/www/cctv/backend (dummy, not used)
   PHP Version: Pure static
   Database: None
   FTP: No
   ```

3. **Click "Submit"**

### Step 3: Configure Frontend Reverse Proxy

1. **Select Frontend Site**
   - Find `sicamdes.semarnet.id` in website list
   - Click "Settings" (gear icon)

2. **Go to "Configuration File" Tab**

3. **Add Reverse Proxy Configuration**

Find the `<VirtualHost *:800>` block and add this BEFORE the `</VirtualHost>` closing tag:

```apache
    # Enable proxy
    ProxyPreserveHost On
    ProxyRequests Off
    
    # Backend API Proxy
    ProxyPass /api http://localhost:3001/api
    ProxyPassReverse /api http://localhost:3001/api
    
    # HLS Streaming Proxy (via backend for session tracking)
    ProxyPass /hls http://localhost:3001/hls
    ProxyPassReverse /hls http://localhost:3001/hls
    
    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) "ws://localhost:3001/$1" [P,L]
    
    # Static files (React SPA)
    <Directory /var/www/cctv/frontend/dist>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
        
        # React Router - redirect all to index.html
        RewriteEngine On
        RewriteBase /
        RewriteRule ^index\.html$ - [L]
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule . /index.html [L]
    </Directory>
    
    # Cache static assets
    <FilesMatch "\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </FilesMatch>
    
    # Don't cache index.html
    <FilesMatch "index\.html$">
        Header set Cache-Control "no-store, no-cache, must-revalidate"
    </FilesMatch>
    
    # Security headers
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-XSS-Protection "1; mode=block"
```

4. **Click "Save"**

### Step 4: Configure Backend Reverse Proxy

1. **Select Backend Site**
   - Find `api-sicamdes.semarnet.id` in website list
   - Click "Settings" (gear icon)

2. **Go to "Configuration File" Tab**

3. **Add Reverse Proxy Configuration**

Find the `<VirtualHost *:800>` block and replace the content with:

```apache
<VirtualHost *:800>
    ServerName api-sicamdes.semarnet.id
    ServerAlias api-sicamdes.semarnet.id
    
    # Enable proxy
    ProxyPreserveHost On
    ProxyRequests Off
    
    # Backend API Proxy
    ProxyPass / http://localhost:3001/
    ProxyPassReverse / http://localhost:3001/
    
    # HLS Streaming Proxy (via backend for session tracking)
    ProxyPass /hls http://localhost:3001/hls
    ProxyPassReverse /hls http://localhost:3001/hls
    
    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) "ws://localhost:3001/$1" [P,L]
    
    # Security headers
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-XSS-Protection "1; mode=block"
    
    # CORS headers (handled by backend, but add as fallback)
    Header always set Access-Control-Allow-Origin "*"
    Header always set Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
    Header always set Access-Control-Allow-Headers "Content-Type, Authorization, X-API-Key, X-CSRF-Token"
    
    # Logs
    ErrorLog /var/log/apache2/cctv-backend.error.log
    CustomLog /var/log/apache2/cctv-backend.access.log combined
</VirtualHost>
```

4. **Click "Save"**

### Step 5: Test Configuration

```bash
# Test Apache config
apache2ctl configtest
# Should output: Syntax OK

# Reload Apache
systemctl reload apache2
```

### Step 6: Test Endpoints

```bash
# Test frontend
curl -I http://sicamdes.semarnet.id:800
# Should return: 200 OK

# Test backend API
curl http://api-sicamdes.semarnet.id:800/health
# Should return: {"status":"ok",...}

# Test HLS proxy
curl -I http://api-sicamdes.semarnet.id:800/hls/camera1/index.m3u8
# Should return: 200 OK or 404 (if camera not exist)
```

## 🔒 Optional: Setup SSL (HTTPS)

### Via aaPanel UI

1. **Select Site** (sicamdes.semarnet.id)
   - Click "Settings"

2. **Go to "SSL" Tab**

3. **Choose SSL Method:**
   - **Let's Encrypt** (Free, recommended)
     - Enter email
     - Select domain
     - Click "Apply"

4. **Enable Force HTTPS**
   - Toggle "Force HTTPS" switch

5. **Repeat for Backend Site** (api-sicamdes.semarnet.id)

### Update Frontend .env

After SSL enabled:
```env
VITE_API_URL=https://api-sicamdes.semarnet.id
```

Rebuild frontend:
```bash
cd /var/www/cctv/frontend
npm run build
```

### Update Backend .env

```env
ALLOWED_ORIGINS=https://sicamdes.semarnet.id,http://sicamdes.semarnet.id:800,http://172.17.11.12:800
```

Restart backend:
```bash
pm2 restart cctv-backend
```

## 🐛 Troubleshooting

### Frontend shows blank page

**Check:**
```bash
# Verify dist folder exists
ls -la /var/www/cctv/frontend/dist/

# Check Apache error log
tail -f /var/log/apache2/error.log
```

**Fix:**
```bash
cd /var/www/cctv/frontend
npm run build
```

### API returns 502 Bad Gateway

**Check:**
```bash
# Backend running?
pm2 status
pm2 logs cctv-backend

# Backend listening on port 3000?
netstat -tlnp | grep 3000
```

**Fix:**
```bash
pm2 restart cctv-backend
```

### HLS stream not loading

**Check:**
```bash
# MediaMTX running?
pm2 status
pm2 logs mediamtx

# MediaMTX listening on port 8888?
netstat -tlnp | grep 8888

# Test direct access
curl http://localhost:8888/camera1/index.m3u8
```

**Fix:**
```bash
pm2 restart mediamtx
```

### CORS errors in browser console

**Check backend .env:**
```bash
cat /var/www/cctv/backend/.env | grep ALLOWED_ORIGINS
```

Should include your frontend domain.

**Fix:**
```bash
nano /var/www/cctv/backend/.env
# Add: ALLOWED_ORIGINS=https://sicamdes.semarnet.id,...
pm2 restart cctv-backend
```

### Proxy errors

**Check Apache modules:**
```bash
apache2ctl -M | grep proxy
```

Should show:
- proxy_module
- proxy_http_module
- proxy_wstunnel_module

**Fix:**
```bash
a2enmod proxy proxy_http proxy_wstunnel headers rewrite
systemctl restart apache2
```

## 📝 Manual Config (Alternative)

Jika prefer edit config manual:

1. **Find Apache config path:**
   ```bash
   # aaPanel biasanya di:
   /www/server/panel/vhost/apache/
   ```

2. **Create config file:**
   ```bash
   nano /www/server/panel/vhost/apache/sicamdes.semarnet.id.conf
   ```

3. **Use template from:**
   ```bash
   cat /var/www/cctv/deployment/apache.conf
   ```

4. **Test and reload:**
   ```bash
   apache2ctl configtest && systemctl reload apache2
   ```

**⚠️ WARNING:** Manual changes may be overwritten by aaPanel!

## ✅ Verification Checklist

After setup:

- [ ] Frontend accessible: `http://sicamdes.semarnet.id:800`
- [ ] Backend API working: `http://api-sicamdes.semarnet.id:800/health`
- [ ] HLS proxy working: `http://api-sicamdes.semarnet.id:800/hls/`
- [ ] No CORS errors in browser console
- [ ] Video streaming works
- [ ] Admin login works
- [ ] Camera management works
- [ ] SSL enabled (optional)
- [ ] Force HTTPS enabled (optional)

## 📊 Performance Tips

### Enable Apache MPM Event (Better Performance)

```bash
# Disable prefork
a2dismod mpm_prefork

# Enable event
a2enmod mpm_event

# Restart
systemctl restart apache2
```

### Enable Compression

```bash
# Enable modules
a2enmod deflate
a2enmod filter

# Restart
systemctl restart apache2
```

Add to VirtualHost:
```apache
# Compress text files
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json
</IfModule>
```

## 📚 Reference

- **Apache Proxy:** https://httpd.apache.org/docs/2.4/mod/mod_proxy.html
- **aaPanel Docs:** https://www.aapanel.com/reference.html
- **Let's Encrypt:** https://letsencrypt.org/

---

**Last Updated:** 2025-02-01  
**Version:** 1.0.0
