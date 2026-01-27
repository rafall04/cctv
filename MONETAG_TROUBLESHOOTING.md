# Monetag Troubleshooting Guide

## Masalah: Iklan Tidak Muncul

### Root Cause Analysis

**Masalah Utama:** API endpoint `/api/monetag/config` di-forward ke `index.html` (React SPA) instead of backend API.

**Penyebab:** Nginx configuration memiliki 2 server blocks:
- `cctv.raf.my.id` - Frontend (serve React SPA)
- `api-cctv.raf.my.id` - Backend API

Ketika frontend request ke `https://cctv.raf.my.id/api/monetag/config`, request masuk ke **frontend server block** yang tidak punya routing untuk `/api/*`, sehingga fallback ke `index.html`.

**Solusi:** Tambahkan location block `/api/` di frontend server untuk proxy ke backend.

### Checklist Diagnosis

#### 1. Cek API Endpoint
```bash
# Test dari server
curl http://localhost:3000/api/monetag/config

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
      "zoneId": "8123456"
    },
    "nativeBanner": {
      "enabled": true,
      "zoneId": "8234567"
    }
  }
}
```

**Jika 404:**
- **Nginx routing issue** (most common) - `/api/*` tidak di-proxy ke backend
- Backend belum restart setelah deployment
- Route tidak terdaftar
- Nginx tidak proxy ke backend

**Fix untuk 404:**
```bash
# Login ke server
ssh root@172.17.11.12

# Run fix script
cd /var/www/rafnet-cctv
bash deployment/fix-nginx-api-routing.sh
```

**Jika 500:**
- Database error
- Tabel `monetag_settings` tidak ada

#### 2. Cek Database
```bash
# Login ke server
ssh root@172.17.11.12

# Cek tabel
cd /var/www/rafnet-cctv/backend
sqlite3 data/cctv.db "SELECT * FROM monetag_settings;"
```

**Expected Output:**
```
1|1|8123456|1|8234567|0|YOUR_PUSH_ZONE_ID|0|YOUR_SOCIAL_BAR_ZONE_ID|0|YOUR_DIRECT_LINK_ZONE_ID|2024-01-28 10:00:00|1
```

**Jika tabel tidak ada:**
```bash
# Jalankan migration
cd /var/www/rafnet-cctv/backend
node database/migrations/ensure_monetag_settings.js
```

#### 3. Cek Zone ID
Zone ID harus:
- ✅ Berupa angka (contoh: `8123456`)
- ❌ Bukan placeholder (`YOUR_POPUNDER_ZONE_ID`)
- ✅ Valid dari Monetag dashboard

**Cara mendapatkan Zone ID:**
1. Login ke https://www.monetag.com/
2. Menu: Ad Zones → Create Zone
3. Pilih format: Popunder atau Native Banner
4. Copy Zone ID (contoh: `8123456`)

#### 4. Cek Browser Console
Buka Developer Tools (F12) → Console

**Error yang mungkin muncul:**
```
[Monetag] Failed to load config: Error: Network Error
```
→ API endpoint tidak bisa diakses

```
[Monetag] Config loaded but ads disabled
```
→ Zone ID masih placeholder atau format disabled

**Jika tidak ada error:**
- Cek Network tab untuk request ke `topcreativeformat.com`
- Jika ada request tapi iklan tidak muncul → Zone ID salah atau akun Monetag belum approved

#### 5. Cek Backend Logs
```bash
# Cek logs PM2
pm2 logs rafnet-cctv-backend --lines 50

# Cari error terkait Monetag
pm2 logs rafnet-cctv-backend | grep -i monetag
```

**Error yang mungkin muncul:**
```
Error getting Monetag settings: SQLITE_ERROR: no such table: monetag_settings
```
→ Jalankan migration

```
Error getting public Monetag config: ...
```
→ Cek database connection

## Solusi Lengkap

### Opsi 1: Automatic Fix (Recommended)

#### Step 1: Fix Nginx Routing (CRITICAL)
```bash
# Login ke server
ssh root@172.17.11.12

# Fix Nginx API routing
cd /var/www/rafnet-cctv
bash deployment/fix-nginx-api-routing.sh
```

Script akan:
1. ✅ Backup current Nginx config
2. ✅ Update Nginx config dengan /api/ location block
3. ✅ Test Nginx config
4. ✅ Reload Nginx
5. ✅ Test API endpoint

#### Step 2: Ensure Database & Backend
```bash
# Ensure monetag_settings table exists
bash deployment/fix-monetag-complete.sh
```

Script akan:
1. ✅ Ensure tabel `monetag_settings` ada
2. ✅ Restart backend
3. ✅ Test API endpoint
4. ✅ Show current configuration

### Opsi 2: Manual Fix

#### Step 1: Fix Nginx Configuration
```bash
# Backup current config
cp /etc/nginx/sites-available/cctv /etc/nginx/sites-available/cctv.backup

# Edit Nginx config
nano /etc/nginx/sites-available/cctv
```

Tambahkan location block ini di **frontend server block** (sebelum `location /`):
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

Test dan reload:
```bash
# Test config
nginx -t

# Reload Nginx
systemctl reload nginx
```

#### Step 2: Ensure Database
```bash
cd /var/www/rafnet-cctv/backend
node database/migrations/ensure_monetag_settings.js
```

#### Step 3: Restart Backend
```bash
pm2 restart rafnet-cctv-backend
```

#### Step 4: Configure Zone IDs
1. Login admin panel: https://cctv.raf.my.id/admin/login
2. Menu: Pengaturan Monetag
3. Masukkan Zone ID dari Monetag
4. Aktifkan format yang diinginkan
5. Simpan

#### Step 4: Verify
```bash
# Test API
curl https://cctv.raf.my.id/api/monetag/config

# Buka website dan cek browser console
# Seharusnya tidak ada error
```

## Konfigurasi Monetag Dashboard

### 1. Daftar Akun
- URL: https://www.monetag.com/
- Daftar dengan email valid
- Verifikasi email

### 2. Tambah Website
- Menu: Websites → Add Website
- URL: `https://cctv.raf.my.id`
- Category: Video Streaming / Entertainment
- Submit untuk review

### 3. Buat Ad Zones

#### Popunder (Recommended - CPM Tertinggi)
- Menu: Ad Zones → Create Zone
- Format: **Popunder**
- Website: cctv.raf.my.id
- Frequency: 1 per 24 hours
- Copy Zone ID (contoh: `8123456`)

#### Native Banner (Recommended - Tidak Mengganggu)
- Menu: Ad Zones → Create Zone
- Format: **Native Banner**
- Website: cctv.raf.my.id
- Size: 300x250 atau 728x90
- Copy Zone ID (contoh: `8234567`)

### 4. Masukkan ke Admin Panel
- Login: https://cctv.raf.my.id/admin/login
- Menu: Pengaturan Monetag
- Popunder Zone ID: `8123456`
- Native Banner Zone ID: `8234567`
- Aktifkan kedua format
- Simpan

### 5. Tunggu Approval
- Monetag akan review website (1-3 hari)
- Setelah approved, iklan akan mulai muncul
- Cek dashboard untuk statistik

## Verifikasi Iklan Berfungsi

### 1. Cek API Response
```bash
curl https://cctv.raf.my.id/api/monetag/config
```

Harus return:
```json
{
  "success": true,
  "data": {
    "popunder": {
      "enabled": true,
      "zoneId": "8123456"  // Bukan placeholder
    },
    "nativeBanner": {
      "enabled": true,
      "zoneId": "8234567"  // Bukan placeholder
    }
  }
}
```

### 2. Cek Browser Console
- Buka https://cctv.raf.my.id
- F12 → Console
- Tidak ada error `[Monetag]`
- Ada request ke `topcreativeformat.com`

### 3. Cek Network Tab
- F12 → Network
- Filter: `topcreativeformat.com`
- Harus ada request ke:
  - `invoke.js`
  - Ad content

### 4. Test Popunder
- Buka website
- Klik di mana saja (link, button, dll)
- Tab baru harus muncul DI BELAKANG (popunder)
- Hanya 1x per 24 jam

### 5. Test Native Banner
- Buka video player
- Play video
- Banner harus muncul di bawah video
- Label "Advertisement" terlihat

## Troubleshooting Lanjutan

### Iklan Tidak Muncul Meskipun Config Benar

#### Kemungkinan 1: Website Belum Approved
- Cek Monetag dashboard
- Status website harus "Active"
- Jika "Pending", tunggu approval

#### Kemungkinan 2: Zone ID Salah
- Cek Zone ID di Monetag dashboard
- Pastikan Zone ID untuk website yang benar
- Update di admin panel

#### Kemungkinan 3: Ad Blocker
- Disable ad blocker
- Test di incognito mode
- Test di browser lain

#### Kemungkinan 4: Geo-Targeting
- Monetag mungkin tidak serve ads untuk lokasi tertentu
- Test dengan VPN ke negara lain
- Cek Monetag dashboard untuk geo settings

#### Kemungkinan 5: Low Traffic
- Monetag butuh traffic minimum
- Jika traffic rendah, ads mungkin tidak serve
- Tunggu traffic meningkat

### Script Tidak Load

#### Cek CSP Headers
```bash
curl -I https://cctv.raf.my.id | grep -i content-security-policy
```

Pastikan `topcreativeformat.com` dan `inklinkor.com` allowed:
```
Content-Security-Policy: script-src 'self' 'unsafe-inline' https://www.topcreativeformat.com https://inklinkor.com
```

Jika tidak, update di `backend/middleware/securityHeaders.js`

#### Cek CORS
```bash
curl -H "Origin: https://cctv.raf.my.id" -I https://www.topcreativeformat.com/8123456/invoke.js
```

Harus ada header:
```
Access-Control-Allow-Origin: *
```

## Monitoring & Analytics

### 1. Monetag Dashboard
- Login: https://www.monetag.com/
- Menu: Statistics
- Lihat:
  - Impressions (berapa kali iklan ditampilkan)
  - Clicks (berapa kali diklik)
  - Revenue (pendapatan)

### 2. Browser Console Logging
Tambahkan logging di komponen:
```javascript
useEffect(() => {
    if (config) {
        console.log('[Monetag] Config loaded:', config);
        console.log('[Monetag] Popunder enabled:', config.popunder.enabled);
        console.log('[Monetag] Native banner enabled:', config.nativeBanner.enabled);
    }
}, [config]);
```

### 3. Backend Logging
Tambahkan logging di service:
```javascript
export function getPublicMonetagConfig() {
    const config = ...;
    console.log('[Monetag Service] Public config:', config);
    return config;
}
```

## Best Practices

### 1. Jangan Overload Ads
- Maksimal 2-3 format aktif
- Popunder + Native Banner = optimal
- Terlalu banyak ads = bad UX

### 2. Test Secara Berkala
- Test setiap deployment
- Cek browser console
- Verify API endpoint

### 3. Monitor Performance
- Cek Monetag dashboard weekly
- Optimize placement jika perlu
- A/B test different formats

### 4. Respect User Experience
- Popunder: 1x per 24 jam (sudah default)
- Native banner: hanya saat video play
- Jangan block content dengan ads

## Support

Jika masalah masih berlanjut:

1. **Cek Monetag Support:**
   - Email: support@monetag.com
   - Dashboard: Help Center

2. **Cek RAF NET Logs:**
   ```bash
   pm2 logs rafnet-cctv-backend --lines 100
   ```

3. **Test dengan Minimal Setup:**
   - Disable semua format kecuali Popunder
   - Test dengan Zone ID yang valid
   - Jika berhasil, tambahkan format lain satu per satu
