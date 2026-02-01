# aaPanel Quick Setup - RAF NET CCTV

## Prerequisites

1. **Ubuntu 20.04 server dengan aaPanel**
2. **Nginx installed via aaPanel** (Apache bisa tetap running)
3. **Domain sudah pointing:**
   - `cctv.raf.my.id` → Server IP
   - `api-cctv.raf.my.id` → Server IP
4. **Root access**
5. **Cukup disk space untuk recordings** (minimal 50GB recommended)

## Install Nginx via aaPanel

**PENTING:** aaPanel bisa run Apache dan Nginx bersamaan. Nginx akan digunakan sebagai reverse proxy untuk aplikasi ini.

### Steps:

1. **Login to aaPanel**
   - URL: `http://YOUR_SERVER_IP:7800`
   - Login dengan credentials aaPanel Anda

2. **Go to App Store**
   - Click "App Store" di sidebar

3. **Install Nginx**
   - Search: "Nginx"
   - Click "Install" pada Nginx
   - Pilih versi: Latest stable (recommended)
   - Wait for installation (~2-5 minutes)

4. **Verify Installation**
   ```bash
   nginx -v
   # Should output: nginx version: nginx/x.x.x
   ```

5. **Check Services**
   ```bash
   systemctl status nginx
   systemctl status apache2  # Apache masih bisa running
   ```

**Note:** 
- Apache biasanya di port 80/443
- Nginx bisa di port berbeda (kita akan gunakan port 800)
- Atau Apache bisa di-stop jika tidak digunakan: `systemctl stop apache2`

## Recording Storage

**Path:** `/var/www/cctv/recordings/`

**Structure:**
```
/var/www/cctv/recordings/
├── camera1/
│   ├── 20240201_120000.mp4  (10 min segment)
│   ├── 20240201_121000.mp4
│   └── ...
├── camera2/
│   └── ...
```

**Disk Space Calculation:**
- Bitrate: ~1.5 Mbps (typical H.264)
- 10 min segment: ~110 MB
- 24 hours: ~15 GB per camera
- 7 days: ~105 GB per camera

**Safety:**
- ✅ Path di dalam app directory (`/var/www/cctv/`)
- ✅ Owned by root (same as app)
- ✅ Auto-cleanup based on retention period
- ✅ Atomic file operations (crash-safe)
- ✅ No conflicts with aaPanel

**aaPanel Compatibility:**
- ✅ Safe - tidak conflict dengan aaPanel
- ✅ Tidak menggunakan `/www/wwwroot/` (aaPanel default)
- ✅ Tidak menggunakan `/home/` (user directories)
- ✅ Independent dari aaPanel file manager

## One-Command Installation

### Step 1: Prepare Repository

Edit file `deployment/aapanel-install.sh` line 9:
```bash
REPO_URL="https://github.com/YOUR_USERNAME/cctv.git"
```
Ganti dengan URL repository Anda.

### Step 2: Run Installation Script

```bash
# Login as root
cd /tmp

# Download script
wget https://raw.githubusercontent.com/YOUR_USERNAME/cctv/main/deployment/aapanel-install.sh

# Make executable
chmod +x aapanel-install.sh

# Run installation
bash aapanel-install.sh
```

**Script akan otomatis:**
- ✅ Install dependencies (Node.js 20, PM2, Git, FFmpeg)
- ✅ Clone repository
- ✅ Setup backend (.env, database)
- ✅ Build frontend
- ✅ Download & configure MediaMTX
- ✅ Create recordings directory
- ✅ Start PM2 processes
- ⚠️ Nginx setup (manual via aaPanel UI)
- ✅ Setup firewall
- ✅ Verify installation

**Durasi: ~5-10 menit + Nginx setup manual**

**IMPORTANT:** Nginx harus dikonfigurasi manual via aaPanel UI (tidak bisa otomatis).

See [AAPANEL_NGINX_SETUP.md](AAPANEL_NGINX_SETUP.md) for Nginx configuration.

## Manual Installation (Alternative)

Jika prefer manual setup:

### 1. Clone Repository

```bash
mkdir -p /var/www/cctv
cd /var/www/cctv
git clone https://github.com/YOUR_USERNAME/cctv.git .
```

### 2. Run Setup Scripts

```bash
# Install dependencies
npm install -g pm2
apt install -y ffmpeg  # CRITICAL for recording

# Backend setup
cd /var/www/cctv/backend
npm install --production
cp .env.example .env
nano .env  # Edit configuration
npm run setup-db

# Create recordings directory
mkdir -p /var/www/cctv/recordings
chmod 755 /var/www/cctv/recordings

# Frontend setup
cd /var/www/cctv/frontend
npm install
nano .env  # Add VITE_API_BASE_URL and VITE_HLS_BASE_URL
npm run build

# MediaMTX setup
cd /var/www/cctv/mediamtx
wget https://github.com/bluenviron/mediamtx/releases/download/v1.9.0/mediamtx_v1.9.0_linux_amd64.tar.gz
tar -xzf mediamtx_v1.9.0_linux_amd64.tar.gz
chmod +x mediamtx

# Start services
cd /var/www/cctv
mkdir -p logs
pm2 start deployment/ecosystem.config.cjs
pm2 save
pm2 startup

# Configure Nginx
cp deployment/nginx.conf /etc/nginx/sites-available/cctv
ln -sf /etc/nginx/sites-available/cctv /etc/nginx/sites-enabled/cctv
nginx -t && systemctl reload nginx

# Firewall
ufw allow 800/tcp
```

## Configuration Files

### Backend .env (Minimal Required)

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

DATABASE_PATH=./data/cctv.db

JWT_SECRET=GENERATE_32_CHAR_RANDOM_STRING
JWT_EXPIRES_IN=24h

ALLOWED_ORIGINS=https://cctv.raf.my.id,http://cctv.raf.my.id,http://172.17.11.12

MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_HLS_URL=http://localhost:8888

CSRF_SECRET=GENERATE_32_CHAR_RANDOM_STRING

DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin123
```

**Generate secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Frontend .env

```env
VITE_API_BASE_URL=https://api-cctv.raf.my.id
VITE_HLS_BASE_URL=https://api-cctv.raf.my.id/hls
```

**PENTING:** Tidak perlu port `:800` karena Nginx sudah forward.

## Verification

```bash
# Check services
pm2 status
# Should show: cctv-backend (online), cctv-mediamtx (online)

# Check backend
curl http://localhost:3000/health
# Should return: {"status":"ok",...}

# Check MediaMTX
curl http://localhost:9997/v3/config/global/get
# Should return: JSON config

# Check Nginx
systemctl status nginx
# Should be: active (running)

# Test frontend
curl -I http://cctv.raf.my.id:800
# Should return: 200 OK
```

## Access Application

- **Frontend:** http://cctv.raf.my.id:800
- **Admin Login:** Username: `admin`, Password: `admin123`
- **⚠️ CHANGE PASSWORD IMMEDIATELY!**

## Management Commands

```bash
# View logs
pm2 logs cctv-backend
pm2 logs cctv-mediamtx

# Restart services
pm2 restart cctv-backend
pm2 restart cctv-mediamtx

# Update application
cd /var/www/cctv
./deployment/update.sh

# Nginx
nginx -t                    # Test config
systemctl reload nginx      # Reload
systemctl restart nginx     # Restart
```

## Update Deployment

```bash
cd /var/www/cctv
git pull origin main
pm2 restart cctv-backend
cd frontend && npm run build
systemctl reload nginx
```

Or use update script:
```bash
cd /var/www/cctv
./deployment/update.sh
```

## Troubleshooting

### Backend not starting
```bash
pm2 logs cctv-backend --lines 100
# Check for errors in .env or database
```

### Frontend blank page
```bash
cd /var/www/cctv/frontend
npm run build
# Check dist/ folder exists
```

### CORS errors
```bash
# Check backend .env
cat /var/www/cctv/backend/.env | grep ALLOWED_ORIGINS
# Should include: https://cctv.raf.my.id

pm2 restart cctv-backend
```

### Stream not loading
```bash
# Check MediaMTX
curl http://localhost:9997/v3/paths/list
pm2 logs cctv-mediamtx

# Check HLS proxy
curl http://localhost:8888/camera1/index.m3u8
```

## Post-Installation

1. **Change admin password** via admin panel
2. **Setup backup cron:**
   ```bash
   crontab -e
   # Add: 0 2 * * * /var/www/cctv/backup.sh
   ```
3. **Monitor logs:**
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 7
   ```

## Support

**Quick checks:**
```bash
pm2 status                              # All services online?
systemctl status nginx                  # Nginx running?
curl http://localhost:3000/health       # Backend responding?
curl http://localhost:9997/v3/config/global/get  # MediaMTX responding?
```

**Logs:**
```bash
pm2 logs cctv-backend --lines 100
tail -f /var/log/nginx/cctv-backend.error.log
```

---

**Installation time: ~5-10 minutes**
**One command: `bash aapanel-install.sh`**
