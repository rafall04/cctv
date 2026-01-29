# Deployment Configuration Rules

## CRITICAL: Server Paths and Configuration

### Ubuntu 20.04 Production Server Paths

#### Application Directory
```bash
/var/www/rafnet-cctv/
├── backend/
├── frontend/
├── mediamtx/
├── deployment/
└── data/
```

#### Nginx Configuration
```bash
# CORRECT Nginx config path
/etc/nginx/sites-available/rafnet-cctv

# Symlink to enabled
/etc/nginx/sites-enabled/rafnet-cctv -> /etc/nginx/sites-available/rafnet-cctv

# ❌ WRONG - DO NOT USE
/etc/nginx/sites-available/cctv  # SALAH!
```

#### PM2 Ecosystem
```bash
# PM2 config file
/var/www/rafnet-cctv/deployment/ecosystem.config.cjs

# PM2 process names
rafnet-cctv-backend
rafnet-cctv-mediamtx
```

#### Log Files
```bash
# Nginx logs
/var/log/nginx/rafnet-cctv-frontend.access.log
/var/log/nginx/rafnet-cctv-frontend.error.log
/var/log/nginx/rafnet-cctv-backend.access.log
/var/log/nginx/rafnet-cctv-backend.error.log

# PM2 logs
~/.pm2/logs/rafnet-cctv-backend-out.log
~/.pm2/logs/rafnet-cctv-backend-error.log
```

### Deployment Commands Reference

#### Nginx Management
```bash
# Test configuration
nginx -t

# Reload (graceful, no downtime)
systemctl reload nginx

# Restart (brief downtime)
systemctl restart nginx

# Check status
systemctl status nginx

# View logs
tail -f /var/log/nginx/rafnet-cctv-backend.error.log
```

#### PM2 Management
```bash
# Start all processes
pm2 start /var/www/rafnet-cctv/deployment/ecosystem.config.cjs

# Restart backend only
pm2 restart rafnet-cctv-backend

# View logs
pm2 logs rafnet-cctv-backend

# Check status
pm2 status

# Save PM2 configuration
pm2 save

# Setup PM2 startup
pm2 startup
```

#### Application Deployment
```bash
# Standard deployment sequence
cd /var/www/rafnet-cctv
git pull origin main
cd frontend && npm run build
pm2 restart rafnet-cctv-backend
systemctl reload nginx
```

### Configuration File Locations

#### Backend Configuration
```bash
# Environment variables
/var/www/rafnet-cctv/backend/.env

# Server entry point
/var/www/rafnet-cctv/backend/server.js

# Database
/var/www/rafnet-cctv/backend/data/cctv.db
```

#### Frontend Configuration
```bash
# Environment variables
/var/www/rafnet-cctv/frontend/.env

# Build output
/var/www/rafnet-cctv/frontend/dist/

# Nginx serves from
/var/www/rafnet-cctv/frontend/dist/
```

#### MediaMTX Configuration
```bash
# Config file
/var/www/rafnet-cctv/mediamtx/mediamtx.yml

# Binary
/var/www/rafnet-cctv/mediamtx/mediamtx

# Recordings (if enabled)
/var/www/rafnet-cctv/mediamtx/recordings/
```

### Port Configuration

| Service | Port | Access |
|---------|------|--------|
| Nginx HTTP | 800 | Public (aaPanel uses 80) |
| Backend API | 3000 | Internal only |
| MediaMTX HLS | 8888 | Internal only |
| MediaMTX WebRTC | 8889 | Internal only |
| MediaMTX API | 9997 | Internal only |

### Domain Configuration

```bash
# Frontend domain
cctv.raf.my.id:800

# Backend API domain
api-cctv.raf.my.id:800

# Internal IP (fallback)
172.17.11.12:800
```

### Security Configuration

#### File Permissions
```bash
# Application files
chown -R root:root /var/www/rafnet-cctv
chmod -R 755 /var/www/rafnet-cctv

# Sensitive files
chmod 600 /var/www/rafnet-cctv/backend/.env
chmod 600 /var/www/rafnet-cctv/frontend/.env
chmod 600 /var/www/rafnet-cctv/backend/data/*.db

# Scripts
chmod +x /var/www/rafnet-cctv/deployment/*.sh
```

#### Nginx Security
```bash
# Config location
/etc/nginx/sites-available/rafnet-cctv

# Test before applying
nginx -t

# Apply changes
systemctl reload nginx
```

### Backup Locations

```bash
# Nginx config backups
/etc/nginx/sites-available/rafnet-cctv.backup.YYYYMMDD

# Database backups
/var/www/rafnet-cctv/data.backup.YYYYMMDD_HHMMSS/

# Application backups
/var/www/rafnet-cctv.backup.YYYYMMDD/
```

## Common Deployment Scenarios

### 1. Update Backend Code
```bash
cd /var/www/rafnet-cctv
git pull origin main
pm2 restart rafnet-cctv-backend
pm2 logs rafnet-cctv-backend --lines 50
```

### 2. Update Frontend Code
```bash
cd /var/www/rafnet-cctv
git pull origin main
cd frontend
npm run build
# Nginx automatically serves new dist/
```

### 3. Update Nginx Configuration
```bash
cd /var/www/rafnet-cctv
git pull origin main
cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
nginx -t
systemctl reload nginx
```

### 4. Update MediaMTX Configuration
```bash
cd /var/www/rafnet-cctv
git pull origin main
pm2 restart rafnet-cctv-mediamtx
pm2 logs rafnet-cctv-mediamtx --lines 50
```

### 5. Database Migration
```bash
cd /var/www/rafnet-cctv
git pull origin main
node backend/database/migrations/migration_name.js
pm2 restart rafnet-cctv-backend
```

### 6. Full Deployment (All Components)
```bash
cd /var/www/rafnet-cctv
git pull origin main

# Backend
pm2 restart rafnet-cctv-backend

# Frontend
cd frontend && npm run build && cd ..

# Nginx
cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
nginx -t && systemctl reload nginx

# MediaMTX (if config changed)
pm2 restart rafnet-cctv-mediamtx

# Verify
pm2 status
systemctl status nginx
```

## Troubleshooting Commands

### Check Service Status
```bash
# All services
pm2 status
systemctl status nginx

# Specific service
pm2 describe rafnet-cctv-backend
systemctl status nginx
```

### View Logs
```bash
# Backend logs
pm2 logs rafnet-cctv-backend --lines 100

# Nginx error logs
tail -f /var/log/nginx/rafnet-cctv-backend.error.log

# Nginx access logs
tail -f /var/log/nginx/rafnet-cctv-backend.access.log
```

### Test Connectivity
```bash
# Test backend API
curl http://localhost:3000/health

# Test MediaMTX
curl http://localhost:9997/v3/config/global/get

# Test Nginx proxy
curl http://localhost:800/api/cameras/active
```

### Emergency Recovery
```bash
# Restore Nginx config
cp /etc/nginx/sites-available/rafnet-cctv.backup.YYYYMMDD /etc/nginx/sites-available/rafnet-cctv
nginx -t && systemctl reload nginx

# Restore database
cp /var/www/rafnet-cctv/data.backup.YYYYMMDD_HHMMSS/cctv.db /var/www/rafnet-cctv/backend/data/cctv.db
pm2 restart rafnet-cctv-backend

# Rollback code
cd /var/www/rafnet-cctv
git log --oneline -10
git reset --hard <commit-hash>
pm2 restart all
```

## Verification Checklist

After any deployment:

- [ ] `pm2 status` - All processes running
- [ ] `systemctl status nginx` - Nginx active
- [ ] `curl http://localhost:3000/health` - Backend responding
- [ ] `curl http://localhost:9997/v3/config/global/get` - MediaMTX responding
- [ ] Open browser: `http://cctv.raf.my.id:800` - Frontend loads
- [ ] Test camera stream - Video plays
- [ ] Check logs for errors - No critical errors

## Important Notes

1. **Always use full path** `/etc/nginx/sites-available/rafnet-cctv` (not `cctv`)
2. **Always test Nginx** before reload: `nginx -t`
3. **Always backup** before major changes
4. **Always verify** after deployment
5. **Always check logs** for errors
6. **Use PM2 process names** exactly: `rafnet-cctv-backend`, `rafnet-cctv-mediamtx`
7. **Port 800** for Nginx (not 80, used by aaPanel)
8. **Run as root** on Ubuntu 20.04 production server

## Quick Reference Card

```bash
# Deployment
cd /var/www/rafnet-cctv && git pull

# Nginx
nginx -t && systemctl reload nginx

# Backend
pm2 restart rafnet-cctv-backend

# Frontend
cd frontend && npm run build

# Logs
pm2 logs rafnet-cctv-backend
tail -f /var/log/nginx/rafnet-cctv-backend.error.log

# Status
pm2 status
systemctl status nginx
```
