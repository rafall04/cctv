# RAF NET CCTV - Docker Setup Guide

## 🐳 Quick Start (One Command)

```bash
# Download and run installation script
curl -fsSL https://raw.githubusercontent.com/rafall04/cctv/main/deployment/docker-install.sh | sudo bash
```

**Duration:** ~5-10 minutes

## 📋 What Gets Installed

- Docker Engine
- Docker Compose
- RAF NET CCTV (all services in containers)
- Nginx (reverse proxy)
- MediaMTX (streaming server)
- SQLite database (initialized)

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│  Host Machine (Port 800)                │
│  ┌───────────────────────────────────┐  │
│  │  Nginx Container                  │  │
│  │  - Serves frontend (React SPA)    │  │
│  │  - Proxies /api → Backend         │  │
│  │  - Proxies /hls → Backend         │  │
│  └───────────────────────────────────┘  │
│              ↓                           │
│  ┌───────────────────────────────────┐  │
│  │  CCTV App Container               │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │ Backend (Fastify)           │  │  │
│  │  │ - Port 3000                 │  │  │
│  │  │ - HLS Proxy                 │  │  │
│  │  └─────────────────────────────┘  │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │ MediaMTX                    │  │  │
│  │  │ - HLS: 8888                 │  │  │
│  │  │ - WebRTC: 8889              │  │  │
│  │  │ - API: 9997                 │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
│              ↓                           │
│  ┌───────────────────────────────────┐  │
│  │  Volumes (Persistent Data)        │  │
│  │  - backend/data (SQLite)          │  │
│  │  - recordings (MP4 files)         │  │
│  │  - logs                           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## 🚀 Manual Installation

### 1. Install Docker

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable docker
sudo systemctl start docker

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Clone Repository

```bash
git clone https://github.com/rafall04/cctv.git /var/www/rafnet-cctv
cd /var/www/rafnet-cctv
```

### 3. Configure Environment

**Backend (.env):**

```bash
cd backend
cp .env.example .env
nano .env
```

Update these values:

```env
BACKEND_DOMAIN=api-cctv.yourdomain.com
FRONTEND_DOMAIN=cctv.yourdomain.com
SERVER_IP=your.server.ip
PORT_PUBLIC=800

# Generate secrets
JWT_SECRET=$(openssl rand -hex 32)
API_KEY_SECRET=$(openssl rand -hex 32)
CSRF_SECRET=$(openssl rand -hex 16)
```

**Frontend (.env):**

```bash
cd ../frontend
nano .env
```

```env
VITE_API_URL=http://your.server.ip:800
VITE_FRONTEND_DOMAIN=cctv.yourdomain.com
```

### 4. Build and Start

```bash
cd /var/www/rafnet-cctv

# Build images
docker-compose build

# Start containers
docker-compose up -d

# Initialize database
docker-compose exec cctv-app sh -c "cd backend && npm run setup-db"

# Run migrations
docker-compose exec cctv-app sh -c "cd backend/database/migrations && for f in *.js; do node \$f; done"
```

### 5. Verify Installation

```bash
# Check containers
docker-compose ps

# Check logs
docker-compose logs -f

# Test backend
curl http://localhost:3000/health

# Test frontend
curl http://localhost:800
```

## 📊 Management Commands

### Container Management

```bash
# View status
docker-compose ps

# View logs
docker-compose logs -f
docker-compose logs -f cctv-app
docker-compose logs -f nginx

# Stop containers
docker-compose stop

# Start containers
docker-compose start

# Restart containers
docker-compose restart

# Restart specific service
docker-compose restart cctv-app

# Stop and remove containers
docker-compose down

# Stop and remove with volumes (CAUTION: deletes data!)
docker-compose down -v
```

### Application Management

```bash
# Access container shell
docker-compose exec cctv-app sh

# Run backend commands
docker-compose exec cctv-app sh -c "cd backend && npm run setup-db"

# View PM2 status inside container
docker-compose exec cctv-app pm2 list

# View PM2 logs inside container
docker-compose exec cctv-app pm2 logs
```

### Database Management

```bash
# Backup database
docker-compose exec cctv-app sh -c "cp backend/data/cctv.db backend/data/cctv_backup_$(date +%Y%m%d).db"

# Copy backup to host
docker cp rafnet-cctv:/app/backend/data/cctv_backup_20250203.db ./

# Restore database
docker cp ./cctv_backup.db rafnet-cctv:/app/backend/data/cctv.db
docker-compose restart cctv-app
```

### Update Application

```bash
cd /var/www/rafnet-cctv

# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose up -d --build

# Or rebuild specific service
docker-compose up -d --build cctv-app
```

## 🔧 Configuration

### Persistent Data (Volumes)

Data is stored on host machine and mounted into containers:

```yaml
volumes:
  - ./backend/data:/app/backend/data        # SQLite database
  - ./recordings:/app/recordings            # Video recordings
  - ./logs:/app/logs                        # Application logs
  - ./backend/.env:/app/backend/.env:ro     # Backend config
  - ./mediamtx/mediamtx.yml:/app/mediamtx/mediamtx.yml:ro  # MediaMTX config
```

**Benefits:**
- Data persists across container restarts
- Easy backup (just copy folders)
- Can edit .env without rebuilding

### Ports

| Service | Container Port | Host Port | Description |
|---------|---------------|-----------|-------------|
| Nginx | 80 | 800 | Public HTTP |
| Nginx | 443 | 443 | Public HTTPS (optional) |
| Backend | 3000 | 3000 | API (internal) |
| MediaMTX HLS | 8888 | 8888 | HLS streaming (internal) |
| MediaMTX WebRTC | 8889 | 8889 | WebRTC (internal) |
| MediaMTX API | 9997 | 9997 | MediaMTX API (internal) |

**Note:** Only port 800 (and 443 if SSL) needs to be exposed publicly.

### Environment Variables

Edit `.env` files on host, then restart:

```bash
# Edit backend config
nano backend/.env

# Edit frontend config
nano frontend/.env

# Restart to apply changes
docker-compose restart
```

### MediaMTX Configuration

Edit `mediamtx/mediamtx.yml` on host:

```bash
nano mediamtx/mediamtx.yml
docker-compose restart cctv-app
```

## 🔐 SSL/HTTPS Setup

### Option 1: Let's Encrypt (Recommended)

```bash
# Install certbot
sudo apt install certbot

# Generate certificate
sudo certbot certonly --standalone -d cctv.yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/cctv.yourdomain.com/fullchain.pem ssl/
sudo cp /etc/letsencrypt/live/cctv.yourdomain.com/privkey.pem ssl/

# Update nginx config
nano deployment/nginx-docker.conf
```

Add SSL server block:

```nginx
server {
    listen 443 ssl http2;
    server_name cctv.yourdomain.com;
    
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    
    # ... rest of config
}
```

```bash
# Restart nginx
docker-compose restart nginx
```

### Option 2: Self-Signed Certificate

```bash
# Generate certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/privkey.pem \
  -out ssl/fullchain.pem \
  -subj "/CN=cctv.yourdomain.com"

# Update nginx config and restart
docker-compose restart nginx
```

## 🐛 Troubleshooting

### Containers Not Starting

```bash
# Check logs
docker-compose logs

# Check specific service
docker-compose logs cctv-app

# Check Docker daemon
sudo systemctl status docker

# Restart Docker
sudo systemctl restart docker
```

### Backend Health Check Failed

```bash
# Check backend logs
docker-compose logs cctv-app

# Access container
docker-compose exec cctv-app sh

# Check PM2 status
docker-compose exec cctv-app pm2 list

# Check PM2 logs
docker-compose exec cctv-app pm2 logs
```

### Database Issues

```bash
# Check database file
docker-compose exec cctv-app ls -la backend/data/

# Reinitialize database
docker-compose exec cctv-app sh -c "cd backend && npm run setup-db"

# Run migrations
docker-compose exec cctv-app sh -c "cd backend/database/migrations && for f in *.js; do node \$f; done"
```

### Stream Not Loading

```bash
# Check MediaMTX
docker-compose exec cctv-app curl http://localhost:9997/v3/paths/list

# Check HLS endpoint
docker-compose exec cctv-app curl http://localhost:8888/camera1/index.m3u8

# Check backend proxy
curl http://localhost:800/hls/camera1/index.m3u8
```

### Port Already in Use

```bash
# Find process using port
sudo lsof -i :800

# Kill process
sudo kill -9 <PID>

# Or change port in docker-compose.yml
nano docker-compose.yml
# Change "800:80" to "8080:80"
docker-compose up -d
```

### Out of Disk Space

```bash
# Check disk usage
df -h

# Check Docker disk usage
docker system df

# Clean up unused images
docker image prune -a

# Clean up unused volumes
docker volume prune

# Clean up everything (CAUTION!)
docker system prune -a --volumes
```

## 📈 Performance Tuning

### Resource Limits

Edit `docker-compose.yml`:

```yaml
services:
  cctv-app:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### Logging

Limit log size:

```yaml
services:
  cctv-app:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 🔄 Backup & Restore

### Automated Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backup/cctv"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
docker cp rafnet-cctv:/app/backend/data/cctv.db $BACKUP_DIR/cctv_$DATE.db

# Backup recordings (optional, can be large)
# tar -czf $BACKUP_DIR/recordings_$DATE.tar.gz recordings/

# Keep only last 7 days
find $BACKUP_DIR -name "cctv_*.db" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR/cctv_$DATE.db"
```

### Restore

```bash
# Stop containers
docker-compose stop

# Restore database
docker cp ./cctv_backup.db rafnet-cctv:/app/backend/data/cctv.db

# Start containers
docker-compose start
```

## 🆚 Docker vs Traditional Deployment

| Feature | Docker | Traditional (PM2) |
|---------|--------|-------------------|
| Setup Time | 5-10 min | 15-30 min |
| Dependencies | Isolated | System-wide |
| Updates | `docker-compose up -d --build` | Multiple commands |
| Portability | High (works anywhere) | Medium (OS-specific) |
| Resource Usage | +100-200MB overhead | Lower |
| Debugging | Container logs | Direct logs |
| Backup | Copy volumes | Copy files |

**Use Docker if:**
- Quick setup needed
- Multiple environments (dev/staging/prod)
- Easy updates/rollbacks required
- Team collaboration

**Use Traditional if:**
- Maximum performance needed
- Already familiar with PM2
- Tight resource constraints
- Direct system access preferred

## 📚 Additional Resources

- **Docker Docs:** https://docs.docker.com/
- **Docker Compose:** https://docs.docker.com/compose/
- **MediaMTX:** https://github.com/bluenviron/mediamtx
- **Project README:** ../README.md

---

**Made with ❤️ by RAF NET**
