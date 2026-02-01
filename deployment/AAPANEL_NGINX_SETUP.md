# aaPanel Nginx Configuration Guide

## ⚠️ IMPORTANT

aaPanel mengelola Nginx via UI. **JANGAN edit config file manual** karena akan ditimpa oleh aaPanel.

## 📋 Prerequisites

- aaPanel installed
- **Nginx installed via aaPanel** (Apache bisa tetap running di port 80)
- Domain sudah pointing ke server IP:
  - `sicamdes.semarnet.id` → Server IP
  - `api-sicamdes.semarnet.id` → Server IP
- Application installed di `/var/www/cctv`
- Backend running di `localhost:3000`
- MediaMTX running di `localhost:8888`

## 🔧 Install Nginx via aaPanel

Jika Nginx belum terinstall:

1. **Login to aaPanel:** `http://YOUR_SERVER_IP:7800`
2. **Go to:** App Store
3. **Search:** Nginx
4. **Click:** Install (pilih latest stable version)
5. **Wait:** ~2-5 minutes
6. **Verify:** `nginx -v`

**Note:** aaPanel bisa run Apache dan Nginx bersamaan. Nginx akan digunakan untuk aplikasi ini (port 800), Apache bisa tetap di port 80 untuk website lain.

## 🌐 Setup via aaPanel UI

### Step 1: Add Frontend Site

1. **Login to aaPanel**
   - URL: `http://YOUR_SERVER_IP:7800`
   - Login dengan credentials aaPanel

2. **Go to Website Menu**
   - Click "Website" di sidebar
   - Click "Add site" button

3. **Configure Frontend Site**
   ```
   Domain: cctv.raf.my.id
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

2. **Go to "Reverse Proxy" Tab**

3. **Add Proxy for API**
   - Click "Add Reverse Proxy"
   - Configuration:
     ```
     Proxy Name: Backend API
     Target URL: http://localhost:3000
     Send Domain: $host
     Proxy Directory: /api
     ```
   - Advanced Settings:
     ```
     ☑ Enable Proxy
     ☑ Enable Cache: NO (uncheck)
     ☑ Enable WebSocket: YES (check)
     ```
   - Click "Submit"

4. **Add Proxy for HLS**
   - Click "Add Reverse Proxy" again
   - Configuration:
     ```
     Proxy Name: HLS Streaming
     Target URL: http://localhost:8888
     Send Domain: $host
     Proxy Directory: /hls
     ```
   - Advanced Settings:
     ```
     ☑ Enable Proxy
     ☑ Enable Cache: NO (uncheck)
     ☑ Enable WebSocket: NO (uncheck)
     ```
   - Click "Submit"

### Step 4: Configure Backend Reverse Proxy

1. **Select Backend Site**
   - Find `api-sicamdes.semarnet.id` in website list
   - Click "Settings" (gear icon)

2. **Go to "Reverse Proxy" Tab**

3. **Add Proxy for API**
   - Click "Add Reverse Proxy"
   - Configuration:
     ```
     Proxy Name: Backend API
     Target URL: http://localhost:3000
     Send Domain: $host
     Proxy Directory: /
     ```
   - Advanced Settings:
     ```
     ☑ Enable Proxy
     ☑ Enable Cache: NO (uncheck)
     ☑ Enable WebSocket: YES (check)
     ```
   - Click "Submit"

4. **Add Proxy for HLS**
   - Click "Add Reverse Proxy" again
   - Configuration:
     ```
     Proxy Name: HLS Streaming
     Target URL: http://localhost:8888
     Send Domain: $host
     Proxy Directory: /hls
     ```
   - Advanced Settings:
     ```
     ☑ Enable Proxy
     ☑ Enable Cache: NO (uncheck)
     ☑ Enable WebSocket: NO (uncheck)
     ```
   - Click "Submit"

### Step 5: Configure Static File Caching (Frontend Only)

1. **Select Frontend Site** (`sicamdes.semarnet.id`)
   - Click "Settings"

2. **Go to "Configuration File" Tab**

3. **Add Cache Rules** (after `location /` block)
   ```nginx
   # Cache static assets
   location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
       expires 1y;
       add_header Cache-Control "public, immutable";
   }
   
   # Disable cache for index.html
   location = /index.html {
       expires -1;
       add_header Cache-Control "no-store, no-cache, must-revalidate";
   }
   ```

4. **Click "Save"**

### Step 6: Configure CORS Headers (Backend Site)

1. **Select Backend Site** (`api-sicamdes.semarnet.id`)
   - Click "Settings"

2. **Go to "Configuration File" Tab**

3. **Find the `location /` block** and add:
   ```nginx
   location / {
       proxy_pass http://localhost:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection 'upgrade';
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_cache_bypass $http_upgrade;
       
       # Timeouts
       proxy_connect_timeout 60s;
       proxy_send_timeout 60s;
       proxy_read_timeout 60s;
   }
   ```

4. **Find the `/hls` location block** and add:
   ```nginx
   location /hls/ {
       proxy_pass http://localhost:8888/;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       
       # HLS specific
       proxy_buffering off;
       proxy_cache off;
       
       # CORS headers for HLS
       add_header Access-Control-Allow-Origin * always;
       add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
       add_header Access-Control-Allow-Headers "Range, Content-Type" always;
       add_header Cache-Control "no-cache, no-store, must-revalidate" always;
       
       # Handle OPTIONS
       if ($request_method = 'OPTIONS') {
           return 204;
       }
   }
   ```

5. **Click "Save"**

### Step 7: Test Configuration

1. **Test Nginx Config**
   ```bash
   nginx -t
   ```
   Should output: `syntax is ok, test is successful`

2. **Reload Nginx**
   - Via aaPanel: Website > Service > Nginx > Reload
   - Or via SSH: `systemctl reload nginx`

3. **Test Frontend**
   ```bash
   curl -I http://cctv.raf.my.id:800
   # Should return: 200 OK
   ```

4. **Test Backend API**
   ```bash
   curl http://api-sicamdes.semarnet.id:800/health
   # Should return: {"status":"ok",...}
   ```

5. **Test HLS Streaming**
   ```bash
   curl -I http://api-sicamdes.semarnet.id:800/hls/camera1/index.m3u8
   # Should return: 200 OK or 404 (if camera not exist)
   ```

## 🔒 Optional: Setup SSL (HTTPS)

### Via aaPanel UI

1. **Select Site** (cctv.raf.my.id)
   - Click "Settings"

2. **Go to "SSL" Tab**

3. **Choose SSL Method:**
   - **Let's Encrypt** (Free, recommended)
     - Enter email
     - Select domain
     - Click "Apply"
   - **Manual Upload**
     - Upload certificate files
     - Click "Save"

4. **Enable Force HTTPS**
   - Toggle "Force HTTPS" switch

5. **Repeat for Backend Site** (api-sicamdes.semarnet.id)

### Update Frontend .env

After SSL enabled:
```env
VITE_API_BASE_URL=https://api-sicamdes.semarnet.id
VITE_HLS_BASE_URL=https://api-sicamdes.semarnet.id/hls
```

Rebuild frontend:
```bash
cd /var/www/cctv/frontend
npm run build
```

### Update Backend .env

```env
ALLOWED_ORIGINS=https://cctv.raf.my.id,http://cctv.raf.my.id,http://172.17.11.12
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

# Check Nginx error log via aaPanel
# Website > Settings > Log > Error Log
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
pm2 logs cctv-mediamtx

# MediaMTX listening on port 8888?
netstat -tlnp | grep 8888

# Test direct access
curl http://localhost:8888/camera1/index.m3u8
```

**Fix:**
```bash
pm2 restart cctv-mediamtx
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
# Add: ALLOWED_ORIGINS=https://cctv.raf.my.id,...
pm2 restart cctv-backend
```

### Port 800 not accessible

**Check firewall:**
```bash
ufw status
# Should show: 800/tcp ALLOW
```

**Fix:**
```bash
ufw allow 800/tcp
```

## 📝 Manual Config (Alternative)

Jika prefer edit config manual (not recommended):

1. **Find Nginx config path via aaPanel:**
   - Website > Settings > Configuration File
   - Path biasanya: `/www/server/panel/vhost/nginx/`

2. **Edit config file:**
   ```bash
   nano /www/server/panel/vhost/nginx/cctv.raf.my.id.conf
   ```

3. **Use template from:**
   ```bash
   cat /var/www/cctv/deployment/nginx.conf
   ```

4. **Test and reload:**
   ```bash
   nginx -t && systemctl reload nginx
   ```

**⚠️ WARNING:** Manual changes may be overwritten by aaPanel!

## ✅ Verification Checklist

After setup:

- [ ] Frontend accessible: `http://cctv.raf.my.id:800`
- [ ] Backend API working: `http://api-sicamdes.semarnet.id:800/health`
- [ ] HLS proxy working: `http://api-sicamdes.semarnet.id:800/hls/`
- [ ] No CORS errors in browser console
- [ ] Video streaming works
- [ ] Admin login works
- [ ] Camera management works
- [ ] SSL enabled (optional)
- [ ] Force HTTPS enabled (optional)

## 📚 Reference

- **aaPanel Docs:** https://www.aapanel.com/reference.html
- **Nginx Reverse Proxy:** https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/
- **Let's Encrypt:** https://letsencrypt.org/

---

**Last Updated:** 2025-02-01  
**Version:** 1.0.0
