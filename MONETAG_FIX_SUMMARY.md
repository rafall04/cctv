# Monetag Fix Summary

## Masalah yang Ditemukan

### Root Cause
API endpoint `/api/monetag/config` mengembalikan **404** atau **redirect ke index.html** karena **Nginx routing issue**.

### Analisis Teknis

**Nginx Configuration** memiliki 2 server blocks:
```nginx
# Server 1: Frontend (cctv.raf.my.id)
server {
    listen 800;
    server_name cctv.raf.my.id 172.17.11.12;
    root /var/www/rafnet-cctv/frontend/dist;
    
    location / {
        try_files $uri $uri/ /index.html;  # ❌ Fallback ke index.html
    }
}

# Server 2: Backend API (api-cctv.raf.my.id)
server {
    listen 800;
    server_name api-cctv.raf.my.id;
    
    location / {
        proxy_pass http://localhost:3000;  # ✅ Proxy ke backend
    }
}
```

**Flow yang Salah:**
1. Frontend request: `https://cctv.raf.my.id/api/monetag/config`
2. Nginx match: Server block `cctv.raf.my.id` (frontend)
3. Location match: `location /` (karena tidak ada `/api/`)
4. Action: `try_files $uri $uri/ /index.html`
5. Result: Return `index.html` (React SPA) ❌

**Flow yang Benar:**
1. Frontend request: `https://cctv.raf.my.id/api/monetag/config`
2. Nginx match: Server block `cctv.raf.my.id` (frontend)
3. Location match: `location /api/` ✅
4. Action: `proxy_pass http://localhost:3000`
5. Result: Backend API response ✅

## Solusi yang Diterapkan

### 1. Update Nginx Configuration

**File:** `deployment/nginx.conf`

**Perubahan:** Tambahkan location blocks di frontend server:

```nginx
# Backend API Proxy (from Frontend Domain)
location /api/ {
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

# HLS Stream Proxy (from Frontend Domain)
location /hls/ {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Disable buffering for live streaming
    proxy_buffering off;
    proxy_cache off;
    
    # Timeouts for streaming
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
```

**Urutan Location Blocks (PENTING):**
```nginx
server {
    # 1. Exact matches first
    location = /sw.js { ... }
    location = /robots.txt { ... }
    
    # 2. Prefix matches (specific to general)
    location /api/ { ... }      # ✅ Must be BEFORE location /
    location /hls/ { ... }      # ✅ Must be BEFORE location /
    
    # 3. Catch-all (must be LAST)
    location / { ... }          # ✅ Fallback untuk SPA
}
```

### 2. Deployment Scripts

#### Script 1: Fix Nginx Routing
**File:** `deployment/fix-nginx-api-routing.sh`

**Fungsi:**
- Backup current Nginx config
- Update Nginx config dengan location blocks baru
- Test Nginx config (`nginx -t`)
- Reload Nginx (`systemctl reload nginx`)
- Test API endpoint (localhost dan external)

**Usage:**
```bash
ssh root@172.17.11.12
cd /var/www/rafnet-cctv
bash deployment/fix-nginx-api-routing.sh
```

#### Script 2: Complete Monetag Fix
**File:** `deployment/fix-monetag-complete.sh`

**Fungsi:**
- Ensure tabel `monetag_settings` exists
- Verify database structure
- Restart backend PM2
- Test API endpoint
- Show configuration instructions

**Usage:**
```bash
ssh root@172.17.11.12
cd /var/www/rafnet-cctv
bash deployment/fix-monetag-complete.sh
```

### 3. Documentation

**File:** `MONETAG_TROUBLESHOOTING.md`

**Isi:**
- Root cause analysis
- Diagnosis checklist
- Automatic fix (scripts)
- Manual fix (step-by-step)
- Monetag dashboard configuration
- Verification steps
- Advanced troubleshooting

## Deployment Steps

### Step 1: Pull Latest Code
```bash
ssh root@172.17.11.12
cd /var/www/rafnet-cctv
git pull origin main
```

### Step 2: Fix Nginx Routing (CRITICAL)
```bash
bash deployment/fix-nginx-api-routing.sh
```

**Expected Output:**
```
✅ Backup created
✅ Nginx config updated
✅ Nginx config test passed
✅ Nginx reloaded successfully
✅ API endpoint working! (HTTP 200)
```

### Step 3: Ensure Database & Backend
```bash
bash deployment/fix-monetag-complete.sh
```

**Expected Output:**
```
✅ Migration completed successfully
✅ Table exists with 1 row(s)
✅ Backend restarted successfully
✅ API endpoint working (HTTP 200)
```

### Step 4: Verify API Endpoint
```bash
# Test dari server
curl http://localhost:800/api/monetag/config

# Test dari browser
curl https://cctv.raf.my.id/api/monetag/config
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "popunder": {
      "enabled": true,
      "zoneId": "YOUR_POPUNDER_ZONE_ID"
    },
    "nativeBanner": {
      "enabled": true,
      "zoneId": "YOUR_NATIVE_ZONE_ID"
    },
    "pushNotifications": {
      "enabled": false,
      "zoneId": "YOUR_PUSH_ZONE_ID",
      "swPath": "/sw.js"
    },
    "socialBar": {
      "enabled": false,
      "zoneId": "YOUR_SOCIAL_BAR_ZONE_ID"
    },
    "directLink": {
      "enabled": false,
      "zoneId": "YOUR_DIRECT_LINK_ZONE_ID"
    }
  }
}
```

### Step 5: Configure Monetag Zone IDs

1. **Login Admin Panel:**
   - URL: https://cctv.raf.my.id/admin/login
   - Username: `admin`
   - Password: (your password)

2. **Buka Menu Pengaturan Monetag**

3. **Masukkan Zone IDs dari Monetag Dashboard:**
   - Popunder Zone ID: (dari Monetag)
   - Native Banner Zone ID: (dari Monetag)
   - Aktifkan format yang diinginkan

4. **Simpan Pengaturan**

### Step 6: Verify Ads Working

1. **Cek Browser Console:**
   - Buka https://cctv.raf.my.id
   - F12 → Console
   - Tidak ada error `[Monetag]`

2. **Cek Network Tab:**
   - F12 → Network
   - Filter: `topcreativeformat.com`
   - Harus ada request ke `invoke.js`

3. **Test Popunder:**
   - Klik di mana saja di website
   - Tab baru muncul di belakang (1x per 24 jam)

4. **Test Native Banner:**
   - Play video
   - Banner muncul di bawah video player

## Files Changed

### Modified Files
1. `deployment/nginx.conf` - Added `/api/` and `/hls/` location blocks
2. `MONETAG_TROUBLESHOOTING.md` - Updated with root cause analysis

### New Files
1. `deployment/fix-nginx-api-routing.sh` - Automatic Nginx fix script
2. `deployment/fix-monetag-complete.sh` - Complete Monetag setup script
3. `MONETAG_FIX_SUMMARY.md` - This file

## Technical Details

### Why This Fix Works

**Before Fix:**
```
Request: https://cctv.raf.my.id/api/monetag/config
  ↓
Nginx: server_name cctv.raf.my.id
  ↓
Location: / (catch-all)
  ↓
Action: try_files $uri $uri/ /index.html
  ↓
Result: index.html (404 in React Router)
```

**After Fix:**
```
Request: https://cctv.raf.my.id/api/monetag/config
  ↓
Nginx: server_name cctv.raf.my.id
  ↓
Location: /api/ (specific match)
  ↓
Action: proxy_pass http://localhost:3000
  ↓
Backend: Fastify handles /api/monetag/config
  ↓
Result: JSON response with Monetag config
```

### Nginx Location Matching Priority

Nginx matches locations in this order:
1. **Exact match:** `location = /path`
2. **Prefix match (longest first):** `location /api/`
3. **Regex match:** `location ~ \.php$`
4. **Catch-all:** `location /`

Our fix adds `/api/` as prefix match, which has higher priority than catch-all `/`.

### Why Not Use Subdomain?

**Option A: Same Domain (Implemented)**
```
Frontend: https://cctv.raf.my.id
API: https://cctv.raf.my.id/api/*
```
✅ No CORS issues
✅ Simpler frontend config
✅ Single SSL certificate

**Option B: Subdomain**
```
Frontend: https://cctv.raf.my.id
API: https://api-cctv.raf.my.id/api/*
```
❌ CORS configuration needed
❌ Frontend needs to know API domain
❌ Separate SSL certificate

## Verification Checklist

After deployment, verify:

- [ ] Nginx config test passes (`nginx -t`)
- [ ] Nginx reloaded successfully
- [ ] API endpoint returns 200: `curl http://localhost:800/api/monetag/config`
- [ ] External API works: `curl https://cctv.raf.my.id/api/monetag/config`
- [ ] Backend logs show no errors: `pm2 logs rafnet-cctv-backend`
- [ ] Database has monetag_settings table
- [ ] Frontend can load Monetag config (check browser console)
- [ ] No CORS errors in browser console
- [ ] Monetag scripts load from `topcreativeformat.com`

## Troubleshooting

### If API Still Returns 404

1. **Check Nginx config:**
   ```bash
   cat /etc/nginx/sites-available/cctv | grep -A 10 "location /api/"
   ```
   Should show the proxy_pass block.

2. **Check Nginx is using correct config:**
   ```bash
   nginx -T | grep -A 10 "location /api/"
   ```

3. **Check backend is running:**
   ```bash
   pm2 status
   curl http://localhost:3000/api/monetag/config
   ```

4. **Check Nginx error logs:**
   ```bash
   tail -f /var/log/nginx/rafnet-cctv-frontend.error.log
   ```

### If API Returns 502 Bad Gateway

Backend not running or crashed:
```bash
pm2 logs rafnet-cctv-backend --lines 50
pm2 restart rafnet-cctv-backend
```

### If API Returns 500

Database or backend error:
```bash
pm2 logs rafnet-cctv-backend --lines 50
cd /var/www/rafnet-cctv/backend
node database/migrations/ensure_monetag_settings.js
```

## Next Steps

1. **Deploy to Production:**
   ```bash
   ssh root@172.17.11.12
   cd /var/www/rafnet-cctv
   git pull origin main
   bash deployment/fix-nginx-api-routing.sh
   bash deployment/fix-monetag-complete.sh
   ```

2. **Configure Monetag:**
   - Get Zone IDs from Monetag dashboard
   - Update in admin panel
   - Test ads appear

3. **Monitor:**
   - Check Monetag dashboard for impressions
   - Monitor backend logs for errors
   - Verify user experience (ads not intrusive)

## Support

Jika masalah masih berlanjut, cek:
1. `MONETAG_TROUBLESHOOTING.md` - Detailed troubleshooting guide
2. Backend logs: `pm2 logs rafnet-cctv-backend`
3. Nginx logs: `/var/log/nginx/rafnet-cctv-*.log`
4. Browser console: F12 → Console
