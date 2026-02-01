# Deployment Configuration

## Ubuntu 20.04 Production Server

### CRITICAL: Server Paths

```bash
# Application directory
/var/www/rafnet-cctv/

# Nginx config (CORRECT PATH!)
/etc/nginx/sites-available/rafnet-cctv
/etc/nginx/sites-enabled/rafnet-cctv

# ❌ WRONG - DO NOT USE
/etc/nginx/sites-available/cctv  # SALAH!

# PM2 config
/var/www/rafnet-cctv/deployment/ecosystem.config.cjs

# PM2 process names
rafnet-cctv-backend
rafnet-cctv-mediamtx
```

### User Permissions
- **Run as root** - no `sudo` needed
- File ownership: `root:root`
- Scripts run directly without permission escalation

### Port Configuration

| Service | Port | Access | Note |
|---------|------|--------|------|
| Nginx HTTP | 800 | Public | aaPanel uses port 80 |
| Backend API | 3000 | Internal | |
| MediaMTX HLS | 8888 | Internal | |
| MediaMTX WebRTC | 8889 | Internal | |
| MediaMTX API | 9997 | Internal | |

### Domain Configuration
```bash
# Frontend
cctv.raf.my.id:800

# Backend API
api-cctv.raf.my.id:800

# Internal IP (fallback)
172.17.11.12:800
```

## CORS Configuration

### Backend Environment Variables
```env
# .env - Configure allowed origins
ALLOWED_ORIGINS=https://cctv.raf.my.id,http://cctv.raf.my.id,http://172.17.11.12

# Or accept all (not recommended for production)
ALLOWED_ORIGINS=*
```

### Backend CORS Setup
```javascript
// backend/config/config.js
const parseAllowedOrigins = () => {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  }
  return ['https://cctv.raf.my.id', 'http://172.17.11.12'];
};

export const config = {
  security: {
    allowedOrigins: parseAllowedOrigins(),
  },
};

// backend/server.js
await fastify.register(cors, {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'), false);
        }
    },
    credentials: true,
});
```

## Deployment Commands

### Standard Deployment
```bash
cd /var/www/rafnet-cctv
git pull origin main

# Backend
pm2 restart rafnet-cctv-backend

# Frontend
cd frontend && npm run build

# Nginx
nginx -t && systemctl reload nginx
```

### Nginx Management
```bash
# Test config
nginx -t

# Reload (no downtime)
systemctl reload nginx

# Restart (brief downtime)
systemctl restart nginx

# Check status
systemctl status nginx

# View logs
tail -f /var/log/nginx/rafnet-cctv-backend.error.log
```

### PM2 Management
```bash
# Start all
pm2 start /var/www/rafnet-cctv/deployment/ecosystem.config.cjs

# Restart backend only
pm2 restart rafnet-cctv-backend

# View logs
pm2 logs rafnet-cctv-backend

# Check status
pm2 status

# Save config
pm2 save
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
cd frontend && npm run build
# Nginx automatically serves new dist/
```

### 3. Update Nginx Config
```bash
cd /var/www/rafnet-cctv
git pull origin main
cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
nginx -t && systemctl reload nginx
```

### 4. Database Migration
```bash
cd /var/www/rafnet-cctv
git pull origin main
node backend/database/migrations/migration_name.js
pm2 restart rafnet-cctv-backend
```

### 5. Full Deployment
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

# Verify
pm2 status
systemctl status nginx
```

## Git Auto-Push Rules

### MANDATORY: Always Push After Changes

**Windows PowerShell (use semicolons):**
```powershell
# CRITICAL: PowerShell does NOT support &&
# Use semicolons (;) to separate commands

git add . ; git commit -m "Fix: Description" ; git push origin main
```

**Ubuntu 20.04 Bash (use &&):**
```bash
git add . && git commit -m "Fix: Description" && git push origin main
```

### Commit Message Types
- `Fix:` - Bug fixes
- `Feature:` - New functionality
- `Update:` - Configuration/dependency updates
- `Deploy:` - Deployment changes
- `Docs:` - Documentation

## Troubleshooting

### Check Service Status
```bash
pm2 status
systemctl status nginx
```

### View Logs
```bash
# Backend
pm2 logs rafnet-cctv-backend --lines 100

# Nginx error
tail -f /var/log/nginx/rafnet-cctv-backend.error.log

# Nginx access
tail -f /var/log/nginx/rafnet-cctv-backend.access.log
```

### Test Connectivity
```bash
# Backend API
curl http://localhost:3000/health

# MediaMTX
curl http://localhost:9997/v3/config/global/get

# Nginx proxy
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

After deployment:
- [ ] `pm2 status` - All processes running
- [ ] `systemctl status nginx` - Nginx active
- [ ] `curl http://localhost:3000/health` - Backend responding
- [ ] `curl http://localhost:9997/v3/config/global/get` - MediaMTX responding
- [ ] Open browser: `http://cctv.raf.my.id:800` - Frontend loads
- [ ] Test camera stream - Video plays
- [ ] Check logs - No critical errors

## Important Notes

1. **Always use full path:** `/etc/nginx/sites-available/rafnet-cctv` (not `cctv`)
2. **Always test Nginx:** `nginx -t` before reload
3. **Always backup** before major changes
4. **Port 800** for Nginx (not 80, used by aaPanel)
5. **Run as root** on Ubuntu 20.04
6. **PM2 process names:** `rafnet-cctv-backend`, `rafnet-cctv-mediamtx`
