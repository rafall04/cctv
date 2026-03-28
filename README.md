# RAF NET Secure CCTV Hub

A secure, high-performance video streaming system that isolates private IP cameras from public exposure while providing public web access to camera streams.

## 🎯 Key Features

### Public Features
- **Live Camera Viewing** - Real-time HLS streaming without authentication
- **Public Playback Preview** - Playback publik dibatasi ke preview awal untuk privasi
- **Interactive Map** - Leaflet map with camera markers
- **Feedback System** - Public feedback submission
- **Responsive Design** - Works on all devices (mobile, tablet, desktop)
- **Dark Mode** - Eye-friendly dark theme

### Admin Features
- **Camera Management** - CRUD operations for cameras
- **Area Management** - Organize cameras by location (RT/RW/Kelurahan/Kecamatan)
- **User Management** - Multi-user admin access with roles
- **Viewer Analytics** - Real-time viewer tracking
- **Playback Analytics** - Viewer playback tracking terpisah untuk `public_preview` dan `admin_full`
- **Recording Management** - FFmpeg-based recording with admin full playback
- **Feedback Management** - Review and respond to feedback
- **Audit Logging** - Track all admin actions
- **Security** - JWT auth, brute force protection, CSRF protection

### Technical Features
- **Zero CPU Recording** - FFmpeg stream copy (no re-encoding)
- **Tunnel-Optimized** - Handles unstable connections (10s timeout, auto-restart)
- **Web-Compatible MP4** - Optimized for HTTP Range requests and seeking
- **Device-Adaptive** - Optimized for low-end devices ("HP kentang")
- **Auto-Reconnect** - Intelligent stream recovery
- **Health Monitoring** - Auto-restart frozen streams

## 🏗️ Architecture

```
Public User → Frontend (React) → Backend (Fastify) → MediaMTX → Private RTSP Cameras
Admin User → Admin Panel → JWT Auth → API → SQLite Database
Recording → FFmpeg → MP4 Segments → Playback API (`public_preview` / `admin_full`) → Video Player
```

### Tech Stack

**Backend:**
- Node.js 20+ with ES modules
- Fastify 4.28.1 (REST API)
- SQLite with better-sqlite3 (database)
- JWT authentication
- FFmpeg (recording)

**Frontend:**
- React 18.3.1
- Vite 5.3.1 (build tool)
- Tailwind CSS 3.4.4 (styling)
- HLS.js 1.5.15 (video streaming)
- Leaflet 1.9.4 (maps)

**Streaming:**
- MediaMTX v1.9.0 (RTSP to HLS)
- HLS streaming (HTTP Live Streaming)
- WebRTC support (optional)

## 📋 Prerequisites

- **Ubuntu 20.04** (or compatible Linux)
- **Node.js 20+**
- **FFmpeg** (for recording)
- **Nginx** (reverse proxy)
- **Domain** (optional, for HTTPS)
- **Disk Space** (50GB+ recommended for recordings)

## 🚀 Quick Start

### Option 1: One-Command Installation (aaPanel)

For Ubuntu 20.04 with aaPanel:

```bash
# Download and run installation script
cd /tmp
wget https://raw.githubusercontent.com/YOUR_USERNAME/cctv/main/deployment/aapanel-install.sh
chmod +x aapanel-install.sh
bash aapanel-install.sh
```

**What it does:**
- Installs Node.js 20, PM2, FFmpeg
- Clones repository
- Sets up backend (database, .env)
- Builds frontend
- Downloads MediaMTX
- Configures Nginx
- Starts all services

**Duration:** ~5-10 minutes

See [deployment/AAPANEL_QUICK_SETUP.md](deployment/AAPANEL_QUICK_SETUP.md) for details.

### Option 2: Manual Installation

#### 1. Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/cctv.git
cd cctv
```

#### 2. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
nano .env  # Edit configuration
npm run setup-db
npm run migrate
```

#### 3. Frontend Setup

```bash
cd frontend
npm install
npm run build
```

#### 4. MediaMTX Setup

```bash
cd mediamtx
wget https://github.com/bluenviron/mediamtx/releases/download/v1.9.0/mediamtx_v1.9.0_linux_amd64.tar.gz
tar -xzf mediamtx_v1.9.0_linux_amd64.tar.gz
chmod +x mediamtx
```

#### 5. Start Services

```bash
# Install PM2
npm install -g pm2

# Start services
pm2 start deployment/ecosystem.config.cjs
pm2 save
pm2 startup
```

#### 6. Configure Nginx

```bash
cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
ln -s /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## ⚙️ Configuration

### Environment Variables Setup

**CRITICAL: All domains and IPs are configured via environment variables. No hardcoded values!**

#### Quick Setup (Automated)

```bash
cd deployment
chmod +x generate-env-files.sh
./generate-env-files.sh
```

This interactive script will:
- Prompt for your domain, IP, and port
- Generate secure random secrets
- Create `backend/.env` and `frontend/.env` files
- Provide next steps

#### Manual Setup

**1. Backend (`backend/.env`):**

```env
# ===================================
# Domain Configuration
# ===================================
BACKEND_DOMAIN=api-cctv.raf.my.id
FRONTEND_DOMAIN=cctv.raf.my.id
SERVER_IP=172.17.11.12
PORT_PUBLIC=800

# ===================================
# Public Stream URLs
# ===================================
PUBLIC_STREAM_BASE_URL=https://api-cctv.raf.my.id
PUBLIC_HLS_PATH=/hls
PUBLIC_WEBRTC_PATH=/webrtc

# ===================================
# Security Secrets (GENERATE UNIQUE!)
# ===================================
JWT_SECRET=<64-char-hex>
API_KEY_SECRET=<64-char-hex>
CSRF_SECRET=<32-char-hex>

# ===================================
# CORS (leave empty for auto-generation)
# ===================================
ALLOWED_ORIGINS=

# ===================================
# MediaMTX (Internal)
# ===================================
MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_HLS_URL_INTERNAL=http://localhost:8888
MEDIAMTX_WEBRTC_URL_INTERNAL=http://localhost:8889

# ===================================
# Other Settings
# ===================================
PORT=3000
NODE_ENV=production
DATABASE_PATH=./data/cctv.db
```

**2. Frontend (`frontend/.env`):**

```env
# Backend API URL
VITE_API_URL=https://api-cctv.raf.my.id

# Frontend Domain (for meta tags)
VITE_FRONTEND_DOMAIN=cctv.raf.my.id
```

**3. Generate Secrets:**

```bash
# JWT Secret (64 chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# API Key Secret (64 chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# CSRF Secret (32 chars)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

#### Auto-Generated ALLOWED_ORIGINS

If `ALLOWED_ORIGINS` is empty, backend auto-generates from domain config:

```javascript
// Generated from:
FRONTEND_DOMAIN=cctv.raf.my.id
SERVER_IP=172.17.11.12
PORT_PUBLIC=800

// Results in:
ALLOWED_ORIGINS=
  https://cctv.raf.my.id,
  http://cctv.raf.my.id,
  http://cctv.raf.my.id:800,
  http://172.17.11.12,
  http://172.17.11.12:800
```

**Benefits:**
- ✅ No hardcoded domains/IPs in code
- ✅ Easy client setup - just edit .env
- ✅ Automatic CORS configuration
- ✅ Dynamic meta tags in HTML

### MediaMTX (mediamtx.yml)

```yaml
logLevel: info
api: yes
apiAddress: :9997

hls: yes
hlsAddress: :8888
hlsAlwaysRemux: yes
hlsAllowOrigin: '*'
hlsDirectory: /dev/shm/mediamtx-live  # RAM disk for performance

webrtc: yes
webrtcAddress: :8889
webrtcAllowOrigin: '*'

paths:
  all_others:
    source: publisher
    sourceOnDemand: yes
```

## 🔐 Security

### Default Credentials

- **Username:** `admin`
- **Password:** `admin123`
- **⚠️ CHANGE IMMEDIATELY IN PRODUCTION!**

### Security Features

- JWT-based authentication (24h expiration)
- Password hashing with bcrypt
- Brute force protection (max 5 attempts, 15min lockout)
- CSRF protection
- Rate limiting
- Input sanitization
- Security headers (helmet)
- Audit logging
- Session management

### Camera IP Isolation

- RTSP URLs stored server-side only
- Frontend never receives RTSP URLs
- MediaMTX ingests from private network
- Only HLS streams exposed publicly

## 📁 Project Structure

```
rafnet-cctv/
├── backend/              # Fastify API server
│   ├── controllers/      # Route handlers
│   ├── services/         # Business logic (MediaMTX, recording)
│   ├── middleware/       # Auth, validation, security
│   ├── routes/           # API routes
│   ├── database/         # SQLite setup & migrations
│   └── data/             # cctv.db file
├── frontend/             # React SPA
│   ├── src/
│   │   ├── components/   # Reusable components
│   │   ├── pages/        # Page components
│   │   ├── services/     # API clients
│   │   └── utils/        # Video player utilities
│   └── dist/             # Build output
├── mediamtx/             # Streaming server
│   ├── mediamtx          # Binary
│   └── mediamtx.yml      # Configuration
├── deployment/           # Deployment configs
│   ├── AAPANEL_QUICK_SETUP.md  # Deployment guide
│   ├── aapanel-install.sh      # Installation script
│   ├── update.sh               # Update script
│   ├── nginx.conf              # Nginx config
│   └── ecosystem.config.cjs    # PM2 config
├── recordings/           # Recording storage (auto-created)
│   ├── camera1/
│   ├── camera2/
│   └── ...
└── README.md
```

## 📺 Recording & Playback

### Recording Features

- **FFmpeg stream copy** - 0% CPU overhead (no re-encoding)
- **10-minute segments** - MP4 format with web optimization
- **Auto-start** - Recordings start on server boot
- **Health monitoring** - Auto-restart frozen streams
- **Tunnel-optimized** - Handles unstable connections
- **Age-based cleanup** - Retention period with 10% buffer

### Storage

- **Path:** `/var/www/cctv/recordings/camera{id}/`
- **Format:** `YYYYMMDD_HHMMSS.mp4`
- **Bitrate:** ~1.5 Mbps (typical H.264)
- **10 min segment:** ~110 MB
- **24 hours:** ~15 GB per camera
- **7 days:** ~105 GB per camera

### Playback

- **HTTP Range requests** - Smooth seeking
- **Speed control** - 0.5x to 2x
- **Timeline navigation** - Precise seeking
- **Download support** - Full segment download
- **Public preview policy** - Route publik `/playback` hanya menampilkan preview terbatas
- **Admin full playback** - Route `/admin/playback` tetap untuk akses penuh admin
- **Separate playback viewer tracking** - Analytics playback tidak tercampur dengan viewer live

## 🔄 Management

### Update Application

```bash
cd /var/www/cctv
./deployment/update.sh
```

### View Logs

```bash
pm2 logs cctv-backend
pm2 logs cctv-mediamtx
tail -f /var/log/nginx/cctv-backend.error.log
```

### Restart Services

```bash
pm2 restart cctv-backend
pm2 restart cctv-mediamtx
systemctl reload nginx
```

### Backup Database

```bash
cp /var/www/cctv/backend/data/cctv.db /backup/cctv_$(date +%Y%m%d).db
```

## 📊 API Endpoints

### Public (No Auth)

- `GET /health` - Health check
- `GET /api/cameras/active` - List enabled cameras
- `GET /api/stream/:cameraId` - Get stream URLs
- `POST /api/feedback` - Submit feedback
- `GET /hls/:cameraPath/*` - HLS streaming

### Admin (JWT Required)

- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/cameras` - List all cameras
- `POST /api/cameras` - Create camera
- `PUT /api/cameras/:id` - Update camera
- `DELETE /api/cameras/:id` - Delete camera
- `GET /api/admin/stats` - Dashboard stats
- `GET /api/admin/analytics/viewers` - Live viewer analytics
- `GET /api/users` - List users
- `GET /api/recordings/:cameraId/segments` - List playback segments
- `GET /api/recordings/:cameraId/playlist.m3u8` - Generate playback playlist
- `GET /api/playback-viewer/analytics` - Playback viewer analytics

## 🐛 Troubleshooting

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

### Recording not working

```bash
# Check FFmpeg installed
ffmpeg -version

# Check recordings directory
ls -la /var/www/cctv/recordings/

# Check recording status
sqlite3 /var/www/cctv/backend/data/cctv.db "SELECT * FROM cameras WHERE enable_recording = 1"
```

## 📚 Documentation

- **Deployment:** [deployment/AAPANEL_QUICK_SETUP.md](deployment/AAPANEL_QUICK_SETUP.md)
- **Security:** [SECURITY.md](SECURITY.md)
- **Steering Rules:** [.kiro/steering/](. kiro/steering/)

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - See LICENSE file for details

## 📞 Support

- **Issues:** Open a GitHub issue
- **Documentation:** See docs in `deployment/` folder
- **Security:** See SECURITY.md for security policy

---

**Made with ❤️ by RAF NET**

**Version:** 1.0.0  
**Last Updated:** 2025-02-01
