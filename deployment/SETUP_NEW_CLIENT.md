# Setup untuk Client Baru

## Quick Start (3 Langkah)

### 1. Edit Konfigurasi Client

Edit file `deployment/client.config.sh`:

```bash
# CLIENT INFORMATION
CLIENT_NAME="Nama Client"
CLIENT_CODE="clientcode"

# DOMAIN CONFIGURATION
FRONTEND_DOMAIN="cctv.client.com"
BACKEND_DOMAIN="api-cctv.client.com"
SERVER_IP="192.168.1.100"

# PORT CONFIGURATION
NGINX_PORT="80"  # atau 800 jika port 80 dipakai aaPanel

# PROTOCOL
FRONTEND_PROTOCOL="https"  # atau http
BACKEND_PROTOCOL="https"   # atau http

# SECURITY (WAJIB GANTI!)
JWT_SECRET="generate-random-string-here"
API_KEY_SECRET="generate-with-crypto-randomBytes-32"
CSRF_SECRET="generate-with-crypto-randomBytes-16"
```

**Generate secrets:**
```bash
# JWT Secret (any random string)
openssl rand -base64 32

# API Key Secret (64 char hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# CSRF Secret (32 char hex)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 2. Generate Environment Files

```bash
cd /var/www/rafnet-cctv/deployment
chmod +x generate-env.sh
./generate-env.sh
```

Ini akan generate:
- `backend/.env`
- `frontend/.env`
- `deployment/nginx.generated.conf`

### 3. Deploy

```bash
# Copy nginx config
cp deployment/nginx.generated.conf /etc/nginx/sites-available/clientcode-cctv
ln -sf /etc/nginx/sites-available/clientcode-cctv /etc/nginx/sites-enabled/

# Test nginx
nginx -t

# Reload nginx
systemctl reload nginx

# Build frontend
cd frontend && npm run build && cd ..

# Restart backend
pm2 restart clientcode-cctv-backend

# Generate API key dari admin panel
# Login ke admin panel -> Settings -> API Keys -> Generate
# Copy API key ke frontend/.env (VITE_API_KEY)

# Rebuild frontend dengan API key
cd frontend && npm run build
```

## Verifikasi

```bash
# Test backend
curl http://localhost:3000/health

# Test frontend
curl -I http://cctv.client.com

# Test via IP
curl -I http://192.168.1.100:80
```

## Troubleshooting

### Admin tidak bisa login via IP

Cek `ALLOWED_ORIGINS` di backend/.env sudah include IP:
```bash
grep ALLOWED_ORIGINS backend/.env
```

Harus ada:
```
ALLOWED_ORIGINS=http://192.168.1.100:80,http://192.168.1.100,...
```

### CORS Error

1. Cek allowed origins di backend/.env
2. Restart backend: `pm2 restart clientcode-cctv-backend`
3. Cek logs: `pm2 logs clientcode-cctv-backend`

### Stream tidak load

1. Cek MediaMTX running: `curl http://localhost:9997/v3/paths/list`
2. Cek PUBLIC_STREAM_BASE_URL di backend/.env
3. Cek VITE_API_URL di frontend/.env

## File Structure

```
deployment/
├── client.config.sh          # ← EDIT INI untuk client baru
├── generate-env.sh           # Script generator
├── nginx.generated.conf      # Generated nginx config
├── SETUP_NEW_CLIENT.md       # Dokumentasi ini
└── ...

backend/
└── .env                      # Generated dari client.config.sh

frontend/
└── .env                      # Generated dari client.config.sh
```

## Keuntungan Sistem Ini

✅ **1 file untuk semua konfigurasi** - Edit `client.config.sh` saja
✅ **Auto-generate ALLOWED_ORIGINS** - Tidak perlu manual list semua origin
✅ **Support IP access** - Admin bisa login via IP atau domain
✅ **Konsisten** - Backend, frontend, nginx semua sync
✅ **Easy deployment** - 3 langkah untuk client baru

## Migrasi dari Setup Lama

Jika sudah ada deployment:

```bash
# Backup dulu
cp backend/.env backend/.env.backup
cp frontend/.env frontend/.env.backup

# Edit client.config.sh sesuai setup lama
# Jalankan generate-env.sh
./generate-env.sh

# Compare dengan backup
diff backend/.env backend/.env.backup
diff frontend/.env frontend/.env.backup

# Jika OK, deploy seperti biasa
```
