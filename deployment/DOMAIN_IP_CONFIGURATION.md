# Domain & IP Configuration Guide

## Overview

Sistem ini menggunakan **1 file konfigurasi terpusat** untuk memudahkan perubahan domain/IP:

```
deployment/client.config.sh  ← EDIT FILE INI SAJA!
```

Setelah edit, jalankan script generator untuk update semua file:

```bash
bash deployment/generate-env.sh
```

## Quick Start: Ganti Domain/IP

### 1. Edit Konfigurasi

```bash
nano deployment/client.config.sh
```

Edit bagian ini:

```bash
# ============================================
# DOMAIN CONFIGURATION
# ============================================
FRONTEND_DOMAIN="cctv.raf.my.id"      # ← Ganti domain frontend
BACKEND_DOMAIN="api-cctv.raf.my.id"   # ← Ganti domain backend
SERVER_IP="172.17.11.12"               # ← Ganti IP server

# ============================================
# PORT CONFIGURATION
# ============================================
NGINX_PORT="800"                       # ← Ganti port (800 untuk aaPanel)

# ============================================
# PROTOCOL CONFIGURATION
# ============================================
FRONTEND_PROTOCOL="http"               # ← http atau https
BACKEND_PROTOCOL="http"                # ← http atau https
```

### 2. Generate Environment Files

```bash
cd /var/www/rafnet-cctv
bash deployment/generate-env.sh
```

Script ini akan generate:
- `backend/.env` - Backend configuration
- `frontend/.env` - Frontend configuration
- `deployment/nginx.generated.conf` - Nginx configuration

### 3. Deploy Perubahan

```bash
bash deployment/deploy.sh
```

Script ini akan:
1. Generate environment files
2. Copy nginx config
3. Test & reload nginx
4. Rebuild frontend
5. Restart backend

**DONE!** Sistem sudah pakai domain/IP baru.

## File yang Ter-generate

### Backend Environment (`backend/.env`)

```env
# Auto-generated dari client.config.sh

# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Public Stream URLs
PUBLIC_STREAM_BASE_URL=http://api-cctv.raf.my.id:800

# Allowed Origins
ALLOWED_ORIGINS=http://cctv.raf.my.id:800,http://api-cctv.raf.my.id:800,http://172.17.11.12:800,http://172.17.11.12

# ... (security configs, dll)
```

### Frontend Environment (`frontend/.env`)

```env
# Auto-generated dari client.config.sh

# Backend API URL
VITE_API_URL=http://api-cctv.raf.my.id:800

# API Key (generate from admin panel)
VITE_API_KEY=CHANGE_THIS_TO_YOUR_API_KEY
```

### Nginx Configuration (`deployment/nginx.generated.conf`)

```nginx
# Auto-generated dari client.config.sh

server {
    listen 800;
    server_name cctv.raf.my.id 172.17.11.12;
    # ... (proxy configs, dll)
}

server {
    listen 800;
    server_name api-cctv.raf.my.id;
    # ... (proxy configs, dll)
}
```

## Contoh Kasus Penggunaan

### Kasus 1: Ganti Domain Baru

**Scenario:** Client baru dengan domain `cctv.client.com`

```bash
# 1. Edit config
nano deployment/client.config.sh

# Ubah:
CLIENT_NAME="Client Baru"
CLIENT_CODE="client"
FRONTEND_DOMAIN="cctv.client.com"
BACKEND_DOMAIN="api-cctv.client.com"
SERVER_IP="192.168.1.100"

# 2. Generate & deploy
bash deployment/generate-env.sh
bash deployment/deploy.sh
```

### Kasus 2: Ganti Port (Conflict dengan aaPanel)

**Scenario:** Port 80 dipakai aaPanel, pakai port 8080

```bash
# 1. Edit config
nano deployment/client.config.sh

# Ubah:
NGINX_PORT="8080"

# 2. Generate & deploy
bash deployment/generate-env.sh
bash deployment/deploy.sh
```

### Kasus 3: Enable HTTPS (Setelah Install SSL)

**Scenario:** Sudah install SSL certificate

```bash
# 1. Edit config
nano deployment/client.config.sh

# Ubah:
FRONTEND_PROTOCOL="https"
BACKEND_PROTOCOL="https"

# 2. Generate & deploy
bash deployment/generate-env.sh
bash deployment/deploy.sh
```

### Kasus 4: Ganti IP Server

**Scenario:** Migrasi ke server baru

```bash
# 1. Edit config
nano deployment/client.config.sh

# Ubah:
SERVER_IP="172.17.11.20"  # IP baru

# 2. Generate & deploy
bash deployment/generate-env.sh
bash deployment/deploy.sh
```

## Verifikasi Setelah Perubahan

### 1. Cek Environment Files

```bash
# Backend
cat backend/.env | grep PUBLIC_STREAM_BASE_URL
cat backend/.env | grep ALLOWED_ORIGINS

# Frontend
cat frontend/.env | grep VITE_API_URL
```

### 2. Cek Nginx Config

```bash
cat deployment/nginx.generated.conf | grep server_name
cat deployment/nginx.generated.conf | grep listen
```

### 3. Test Services

```bash
# Backend health
curl http://localhost:3000/health

# Frontend (via nginx)
curl http://cctv.raf.my.id:800

# Backend API (via nginx)
curl http://api-cctv.raf.my.id:800/api/cameras/active
```

### 4. Test dari Browser

```
http://cctv.raf.my.id:800           → Frontend
http://api-cctv.raf.my.id:800       → Backend API
http://172.17.11.12:800             → IP Access
```

## Troubleshooting

### Issue: CORS Error setelah ganti domain

**Penyebab:** `ALLOWED_ORIGINS` tidak ter-update

**Solusi:**
```bash
# Re-generate environment
bash deployment/generate-env.sh

# Restart backend
pm2 restart rafnet-cctv-backend

# Verify
cat backend/.env | grep ALLOWED_ORIGINS
```

### Issue: Frontend tidak bisa akses backend

**Penyebab:** `VITE_API_URL` salah

**Solusi:**
```bash
# Cek frontend env
cat frontend/.env | grep VITE_API_URL

# Harus match dengan backend domain
# Re-generate jika salah
bash deployment/generate-env.sh

# Rebuild frontend
cd frontend && npm run build
```

### Issue: Nginx 404 setelah ganti domain

**Penyebab:** Nginx config tidak ter-update

**Solusi:**
```bash
# Re-generate nginx config
bash deployment/generate-env.sh

# Copy ke nginx
cp deployment/nginx.generated.conf /etc/nginx/sites-available/rafnet-cctv

# Test & reload
nginx -t
systemctl reload nginx
```

### Issue: Stream tidak load setelah ganti domain

**Penyebab:** `PUBLIC_STREAM_BASE_URL` tidak ter-update

**Solusi:**
```bash
# Cek backend env
cat backend/.env | grep PUBLIC_STREAM_BASE_URL

# Harus match dengan backend domain
# Re-generate & restart
bash deployment/generate-env.sh
pm2 restart rafnet-cctv-backend
```

## Advanced: Manual Configuration

Jika tidak ingin pakai script generator, edit manual:

### 1. Backend Environment

```bash
nano backend/.env
```

Update:
- `PUBLIC_STREAM_BASE_URL` - Backend domain dengan protocol & port
- `ALLOWED_ORIGINS` - Semua domain yang boleh akses (comma-separated)

### 2. Frontend Environment

```bash
nano frontend/.env
```

Update:
- `VITE_API_URL` - Backend domain dengan protocol & port

### 3. Nginx Configuration

```bash
nano /etc/nginx/sites-available/rafnet-cctv
```

Update:
- `server_name` - Domain frontend & backend
- `listen` - Port nginx

### 4. Deploy Manual

```bash
# Test nginx
nginx -t

# Reload nginx
systemctl reload nginx

# Rebuild frontend
cd frontend && npm run build

# Restart backend
pm2 restart rafnet-cctv-backend
```

## Best Practices

### ✅ DO:
1. **Selalu backup** sebelum perubahan:
   ```bash
   cp backend/.env backend/.env.backup
   cp frontend/.env frontend/.env.backup
   ```

2. **Test di local** dulu sebelum production

3. **Verifikasi** setelah deploy:
   ```bash
   curl http://localhost:3000/health
   curl http://cctv.raf.my.id:800
   ```

4. **Update DNS** sebelum ganti domain

5. **Generate secrets baru** untuk client baru:
   ```bash
   # API Key Secret
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   
   # CSRF Secret
   node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
   ```

### ❌ DON'T:
1. **Jangan edit** file generated langsung (`.env`, `nginx.generated.conf`)
2. **Jangan lupa** restart services setelah perubahan
3. **Jangan skip** nginx test (`nginx -t`)
4. **Jangan pakai** domain yang belum pointing ke server
5. **Jangan lupa** update API key di frontend

## Summary

**Untuk ganti domain/IP:**

1. Edit `deployment/client.config.sh`
2. Run `bash deployment/generate-env.sh`
3. Run `bash deployment/deploy.sh`
4. Verify services

**File yang perlu diperhatikan:**
- `deployment/client.config.sh` - Sumber konfigurasi (EDIT INI)
- `backend/.env` - Auto-generated (JANGAN EDIT MANUAL)
- `frontend/.env` - Auto-generated (JANGAN EDIT MANUAL)
- `deployment/nginx.generated.conf` - Auto-generated (JANGAN EDIT MANUAL)

**Setelah perubahan, selalu:**
- Test nginx config
- Restart backend
- Rebuild frontend
- Verify dari browser
