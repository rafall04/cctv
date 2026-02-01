# Quick Reference - Domain/IP Configuration

## 🚀 Ganti Domain/IP (3 Langkah)

### 1️⃣ Edit Konfigurasi
```bash
nano deployment/client.config.sh
```

Ubah bagian ini:
```bash
FRONTEND_DOMAIN="cctv.raf.my.id"      # Domain frontend
BACKEND_DOMAIN="api-cctv.raf.my.id"   # Domain backend
SERVER_IP="172.17.11.12"               # IP server
NGINX_PORT="800"                       # Port nginx
```

### 2️⃣ Generate Files
```bash
bash deployment/generate-env.sh
```

### 3️⃣ Deploy
```bash
bash deployment/deploy.sh
```

**DONE!** ✅

---

## 📁 File yang Ter-generate

| File | Isi | Edit Manual? |
|------|-----|--------------|
| `backend/.env` | Backend config | ❌ NO |
| `frontend/.env` | Frontend config | ❌ NO |
| `deployment/nginx.generated.conf` | Nginx config | ❌ NO |

**HANYA edit:** `deployment/client.config.sh`

---

## 🔍 Verifikasi

```bash
# Cek backend env
cat backend/.env | grep PUBLIC_STREAM_BASE_URL
cat backend/.env | grep ALLOWED_ORIGINS

# Cek frontend env
cat frontend/.env | grep VITE_API_URL

# Test services
curl http://localhost:3000/health
curl http://cctv.raf.my.id:800
```

---

## 🛠️ Troubleshooting

### CORS Error
```bash
bash deployment/generate-env.sh
pm2 restart rafnet-cctv-backend
```

### Frontend tidak bisa akses backend
```bash
bash deployment/generate-env.sh
cd frontend && npm run build
```

### Nginx 404
```bash
bash deployment/generate-env.sh
nginx -t
systemctl reload nginx
```

---

## 📋 Contoh Kasus

### Ganti Domain Baru
```bash
# Edit client.config.sh
FRONTEND_DOMAIN="cctv.newclient.com"
BACKEND_DOMAIN="api-cctv.newclient.com"

# Generate & deploy
bash deployment/generate-env.sh
bash deployment/deploy.sh
```

### Ganti Port
```bash
# Edit client.config.sh
NGINX_PORT="8080"

# Generate & deploy
bash deployment/generate-env.sh
bash deployment/deploy.sh
```

### Enable HTTPS
```bash
# Edit client.config.sh
FRONTEND_PROTOCOL="https"
BACKEND_PROTOCOL="https"

# Generate & deploy
bash deployment/generate-env.sh
bash deployment/deploy.sh
```

---

## ⚠️ Penting!

### ✅ DO:
- Backup sebelum perubahan
- Test nginx config (`nginx -t`)
- Restart services setelah perubahan
- Update DNS sebelum ganti domain

### ❌ DON'T:
- Edit file `.env` langsung
- Skip nginx test
- Lupa restart backend
- Lupa rebuild frontend

---

## 📖 Dokumentasi Lengkap

Lihat: `deployment/DOMAIN_IP_CONFIGURATION.md`
