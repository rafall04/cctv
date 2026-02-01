# aaPanel Apache Configuration - Step by Step Guide

## 📋 Prerequisites Checklist

Sebelum mulai, pastikan:
- ✅ Script `aapanel-install.sh` sudah selesai dijalankan
- ✅ Backend running: `pm2 status` → `cctv-backend` online
- ✅ MediaMTX running: `pm2 status` → `mediamtx` online
- ✅ Apache running: `systemctl status apache2` → active
- ✅ Frontend built: `/var/www/cctv/frontend/dist/` ada file `index.html`

**Verify:**
```bash
# Check services
pm2 status
systemctl status apache2

# Check backend
curl http://localhost:3000/health
# Should return: {"status":"ok",...}

# Check frontend files
ls -la /var/www/cctv/frontend/dist/
# Should show: index.html, assets/, etc.
```

---

## 🌐 Part 1: Setup Frontend Site (sicamdes.semarnet.id)

### Step 1.1: Login to aaPanel

1. Open browser
2. Go to: `http://YOUR_SERVER_IP:7800`
3. Login dengan username & password aaPanel Anda

### Step 1.2: Add Frontend Site

1. **Click "Website"** di sidebar kiri
2. **Click "Add site"** button (biasanya di kanan atas)
3. **Fill form:**
   ```
   Domain name: sicamdes.semarnet.id
   Port: 800
   Root directory: /var/www/cctv/frontend/dist
   FTP: No (uncheck)
   Database: No (uncheck)
   PHP: Pure static (atau pilih "Do not create")
   ```
4. **Click "Submit"**

**Expected result:** Site muncul di list dengan status "Running"

### Step 1.3: Configure Frontend Apache Config

1. **Find site** `sicamdes.semarnet.id` di website list
2. **Click "Settings"** (icon gear/roda gigi)
3. **Click tab "Configuration File"**
4. **Scroll ke bawah** sampai menemukan `<VirtualHost *:800>`

### Step 1.4: Add Reverse Proxy Configuration

**IMPORTANT:** Tambahkan konfigurasi ini **SEBELUM** tag `</VirtualHost>` penutup.

**Cari baris ini:**
```apache
</VirtualHost>
```

**Tambahkan konfigurasi ini TEPAT DI ATAS baris tersebut:**

```apache
    # ===================================
    # Enable Proxy
    # ===================================
    ProxyPreserveHost On
    ProxyRequests Off
    
    # ===================================
    # Backend API Proxy
    # ===================================
    ProxyPass /api http://localhost:3000/api
    ProxyPassReverse /api http://localhost:3000/api
    
    # ===================================
    # HLS Streaming Proxy (CRITICAL: via backend for session tracking)
    # ===================================
    ProxyPass /hls http://localhost:3000/hls
    ProxyPassReverse /hls http://localhost:3000/hls
    
    # ===================================
    # WebSocket Support
    # ===================================
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) "ws://localhost:3000/$1" [P,L]
    
    # ===================================
    # Static Files (React SPA)
    # ===================================
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
    
    # ===================================
    # Cache Control
    # ===================================
    # Cache static assets
    <FilesMatch "\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </FilesMatch>
    
    # Don't cache index.html
    <FilesMatch "index\.html$">
        Header set Cache-Control "no-store, no-cache, must-revalidate"
    </FilesMatch>
    
    # ===================================
    # Security Headers
    # ===================================
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-XSS-Protection "1; mode=block"
```

**Hasil akhir akan terlihat seperti:**
```apache
<VirtualHost *:800>
    ServerName sicamdes.semarnet.id
    DocumentRoot /var/www/cctv/frontend/dist
    
    # ... existing config ...
    
    # ===================================
    # Enable Proxy
    # ===================================
    ProxyPreserveHost On
    ProxyRequests Off
    
    # ... (paste semua config di atas) ...
    
</VirtualHost>
```

### Step 1.5: Save and Test

1. **Click "Save"** button
2. **Test Apache config:**
   ```bash
   apache2ctl configtest
   # Should output: Syntax OK
   ```
3. **Reload Apache:**
   ```bash
   systemctl reload apache2
   ```
4. **Test frontend:**
   ```bash
   curl -I http://sicamdes.semarnet.id:800
   # Should return: HTTP/1.1 200 OK
   ```

---

## 🔌 Part 2: Setup Backend API Site (api-sicamdes.semarnet.id)

### Step 2.1: Add Backend Site

1. **Click "Website"** di sidebar
2. **Click "Add site"** button
3. **Fill form:**
   ```
   Domain name: api-sicamdes.semarnet.id
   Port: 800
   Root directory: /var/www/cctv/backend (dummy, tidak digunakan)
   FTP: No
   Database: No
   PHP: Pure static
   ```
4. **Click "Submit"**

### Step 2.2: Configure Backend Apache Config

1. **Find site** `api-sicamdes.semarnet.id` di website list
2. **Click "Settings"**
3. **Click tab "Configuration File"**
4. **Replace ENTIRE `<VirtualHost *:800>` block** dengan config ini:

```apache
<VirtualHost *:800>
    ServerName api-sicamdes.semarnet.id
    ServerAlias api-sicamdes.semarnet.id
    
    # ===================================
    # Enable Proxy
    # ===================================
    ProxyPreserveHost On
    ProxyRequests Off
    
    # ===================================
    # Backend API Proxy (Root)
    # ===================================
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    
    # ===================================
    # HLS Streaming Proxy
    # ===================================
    ProxyPass /hls http://localhost:3000/hls
    ProxyPassReverse /hls http://localhost:3000/hls
    
    # ===================================
    # WebSocket Support
    # ===================================
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) "ws://localhost:3000/$1" [P,L]
    
    # ===================================
    # Security Headers
    # ===================================
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-XSS-Protection "1; mode=block"
    
    # CORS headers (handled by backend, but add as fallback)
    Header always set Access-Control-Allow-Origin "*"
    Header always set Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
    Header always set Access-Control-Allow-Headers "Content-Type, Authorization, X-API-Key, X-CSRF-Token"
    
    # ===================================
    # Logs
    # ===================================
    ErrorLog /var/log/apache2/cctv-backend.error.log
    CustomLog /var/log/apache2/cctv-backend.access.log combined
</VirtualHost>
```

### Step 2.3: Save and Test

1. **Click "Save"**
2. **Test config:**
   ```bash
   apache2ctl configtest
   # Should output: Syntax OK
   ```
3. **Reload Apache:**
   ```bash
   systemctl reload apache2
   ```
4. **Test backend API:**
   ```bash
   curl http://api-sicamdes.semarnet.id:800/health
   # Should return: {"status":"ok",...}
   ```

---

## ✅ Part 3: Verification & Testing

### Test 3.1: Frontend Access

**Browser test:**
1. Open: `http://sicamdes.semarnet.id:800`
2. Should show: Landing page dengan map dan camera list
3. Check browser console (F12): No errors

**Command line test:**
```bash
curl -I http://sicamdes.semarnet.id:800
# Expected: HTTP/1.1 200 OK

curl http://sicamdes.semarnet.id:800 | grep -o "<title>.*</title>"
# Expected: <title>RAF NET CCTV</title> (atau title Anda)
```

### Test 3.2: Backend API

```bash
# Health check
curl http://api-sicamdes.semarnet.id:800/health
# Expected: {"status":"ok","timestamp":"..."}

# Get cameras (public endpoint)
curl http://api-sicamdes.semarnet.id:800/api/cameras/active
# Expected: [] atau array of cameras
```

### Test 3.3: API Proxy from Frontend

```bash
# Test API proxy through frontend domain
curl http://sicamdes.semarnet.id:800/api/cameras/active
# Expected: Same result as backend direct access
```

### Test 3.4: HLS Streaming

```bash
# Test HLS proxy (will return 404 if no camera, but should not be 502)
curl -I http://api-sicamdes.semarnet.id:800/hls/camera1/index.m3u8
# Expected: HTTP/1.1 404 Not Found (if camera not exist)
# OR: HTTP/1.1 200 OK (if camera exist and streaming)

# Should NOT return: 502 Bad Gateway
```

### Test 3.5: Check Logs

```bash
# Apache error log
tail -f /var/log/apache2/cctv-backend.error.log
# Should be empty or minimal errors

# Backend logs
pm2 logs cctv-backend --lines 50
# Should show successful requests

# MediaMTX logs
pm2 logs mediamtx --lines 50
# Should show stream activity
```

---

## 🐛 Troubleshooting

### Issue 1: Frontend shows blank page

**Symptoms:**
- Browser shows white/blank page
- No errors in console

**Check:**
```bash
# Verify dist folder
ls -la /var/www/cctv/frontend/dist/
# Should have: index.html, assets/, etc.

# Check Apache error log
tail -50 /var/log/apache2/error.log
```

**Fix:**
```bash
cd /var/www/cctv/frontend
npm run build
systemctl reload apache2
```

### Issue 2: API returns 502 Bad Gateway

**Symptoms:**
- `curl http://api-sicamdes.semarnet.id:800/health` returns 502

**Check:**
```bash
# Backend running?
pm2 status
# Should show: cctv-backend (online)

# Backend listening?
netstat -tlnp | grep 3000
# Should show: LISTEN on port 3000

# Test direct
curl http://localhost:3000/health
# Should work
```

**Fix:**
```bash
pm2 restart cctv-backend
pm2 logs cctv-backend
```

### Issue 3: Proxy not working (404 on /api/)

**Symptoms:**
- Direct backend works: `curl http://localhost:3000/health` ✓
- Proxy fails: `curl http://api-sicamdes.semarnet.id:800/health` ✗

**Check:**
```bash
# Apache modules loaded?
apache2 -M | grep proxy
# Should show:
#  proxy_module (shared)
#  proxy_http_module (shared)
```

**Fix:**
```bash
# Run module enabler
bash /var/www/cctv/deployment/enable-apache-modules.sh

# Restart Apache
systemctl restart apache2
```

### Issue 4: CORS errors in browser

**Symptoms:**
- Browser console shows: "CORS policy blocked"

**Check:**
```bash
# Backend ALLOWED_ORIGINS
cat /var/www/cctv/backend/.env | grep ALLOWED_ORIGINS
# Should include: http://sicamdes.semarnet.id:800
```

**Fix:**
```bash
nano /var/www/cctv/backend/.env
# Add or update:
ALLOWED_ORIGINS=http://sicamdes.semarnet.id:800,https://sicamdes.semarnet.id,http://172.17.11.12:800

pm2 restart cctv-backend
```

### Issue 5: React Router 404 (page refresh fails)

**Symptoms:**
- Homepage works
- Navigate to `/admin` works
- Refresh page → 404 Not Found

**Check:**
```bash
# Verify .htaccess or Apache config has rewrite rules
grep -A5 "RewriteRule" /www/server/panel/vhost/apache/sicamdes.semarnet.id.conf
```

**Fix:**
Pastikan config frontend punya:
```apache
<Directory /var/www/cctv/frontend/dist>
    RewriteEngine On
    RewriteBase /
    RewriteRule ^index\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.html [L]
</Directory>
```

---

## 🔒 Part 4: Optional - Setup SSL (HTTPS)

### Step 4.1: Install SSL Certificate

**Via aaPanel UI:**

1. **Select site** `sicamdes.semarnet.id`
2. **Click "Settings"**
3. **Click tab "SSL"**
4. **Choose method:**
   - **Let's Encrypt** (Free, recommended):
     - Enter email
     - Check domain
     - Click "Apply"
   - **Or upload your own certificate**

5. **Enable "Force HTTPS"** toggle

6. **Repeat for** `api-sicamdes.semarnet.id`

### Step 4.2: Update Frontend .env

```bash
nano /var/www/cctv/frontend/.env
```

Change to:
```env
VITE_API_URL=https://api-sicamdes.semarnet.id
```

Rebuild:
```bash
cd /var/www/cctv/frontend
npm run build
```

### Step 4.3: Update Backend .env

```bash
nano /var/www/cctv/backend/.env
```

Update:
```env
ALLOWED_ORIGINS=https://sicamdes.semarnet.id,http://sicamdes.semarnet.id:800,http://172.17.11.12:800
```

Restart:
```bash
pm2 restart cctv-backend
```

### Step 4.4: Test HTTPS

```bash
curl -I https://sicamdes.semarnet.id
# Should return: HTTP/2 200 (or HTTP/1.1 200)

curl https://api-sicamdes.semarnet.id/health
# Should return: {"status":"ok",...}
```

---

## 📊 Part 5: Final Verification Checklist

Run semua test ini untuk memastikan semuanya berjalan:

```bash
# 1. Services running
pm2 status
# Expected: cctv-backend (online), mediamtx (online)

systemctl status apache2
# Expected: active (running)

# 2. Frontend accessible
curl -I http://sicamdes.semarnet.id:800
# Expected: HTTP/1.1 200 OK

# 3. Backend API working
curl http://api-sicamdes.semarnet.id:800/health
# Expected: {"status":"ok",...}

# 4. API proxy working
curl http://sicamdes.semarnet.id:800/api/cameras/active
# Expected: [] or array

# 5. HLS proxy working
curl -I http://api-sicamdes.semarnet.id:800/hls/camera1/index.m3u8
# Expected: 404 (if no camera) or 200 (if camera exists)

# 6. No errors in logs
tail -20 /var/log/apache2/cctv-backend.error.log
# Expected: Empty or minimal

pm2 logs cctv-backend --lines 20 --nostream
# Expected: No critical errors

# 7. Browser test
# Open: http://sicamdes.semarnet.id:800
# Expected: Landing page loads, no console errors
```

**Checklist:**
- [ ] Frontend loads: `http://sicamdes.semarnet.id:800`
- [ ] Backend API responds: `http://api-sicamdes.semarnet.id:800/health`
- [ ] API proxy works: `/api/cameras/active`
- [ ] HLS proxy configured: `/hls/`
- [ ] No CORS errors in browser
- [ ] React Router works (page refresh)
- [ ] Admin login accessible
- [ ] No errors in Apache logs
- [ ] No errors in PM2 logs
- [ ] SSL enabled (optional)

---

## 🎯 Summary

**What we configured:**

1. **Frontend Site** (`sicamdes.semarnet.id:800`)
   - Serves React SPA from `/var/www/cctv/frontend/dist`
   - Proxies `/api/*` to backend
   - Proxies `/hls/*` to backend (for session tracking)
   - React Router support
   - Static asset caching

2. **Backend API Site** (`api-sicamdes.semarnet.id:800`)
   - Proxies all requests to `localhost:3000`
   - HLS streaming support
   - WebSocket support
   - CORS headers

3. **Architecture:**
   ```
   Browser → Apache (port 800) → Backend (port 3000) → MediaMTX (port 8888)
   ```

**Next Steps:**
1. Login to admin panel: `http://sicamdes.semarnet.id:800/admin`
2. Default credentials: `admin` / `admin123`
3. **CHANGE PASSWORD IMMEDIATELY!**
4. Add cameras via admin panel
5. Test video streaming
6. Setup SSL (recommended)

---

**Need help?** Check:
- Apache logs: `/var/log/apache2/cctv-*.log`
- Backend logs: `pm2 logs cctv-backend`
- MediaMTX logs: `pm2 logs mediamtx`

**Config files:**
- Frontend: `/www/server/panel/vhost/apache/sicamdes.semarnet.id.conf`
- Backend: `/www/server/panel/vhost/apache/api-sicamdes.semarnet.id.conf`
- Template: `/var/www/cctv/deployment/apache.conf`
