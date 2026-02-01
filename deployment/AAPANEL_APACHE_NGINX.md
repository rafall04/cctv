# aaPanel: Running Apache and Nginx Together

## Overview

aaPanel dapat menjalankan Apache dan Nginx secara bersamaan. Ini berguna jika:
- Sudah ada website di Apache (port 80/443)
- Ingin tambah aplikasi baru dengan Nginx sebagai reverse proxy
- Tidak ingin mengganggu website yang sudah ada

## Architecture

```
┌─────────────────────────────────────────┐
│           Server (Ubuntu 20.04)         │
├─────────────────────────────────────────┤
│                                         │
│  Apache (Port 80/443)                   │
│  └─ Website lain yang sudah ada         │
│                                         │
│  Nginx (Port 800)                       │
│  └─ RAF NET CCTV Application            │
│     ├─ Frontend (React SPA)             │
│     ├─ Backend API (Fastify)            │
│     └─ HLS Streaming (MediaMTX)         │
│                                         │
│  Backend (Port 3000) - Internal         │
│  MediaMTX (Port 8888) - Internal        │
│                                         │
└─────────────────────────────────────────┘
```

## Installation Steps

### 1. Check Current Services

```bash
# Check Apache
systemctl status apache2
# Should be: active (running)

# Check if Nginx installed
nginx -v
# If not found, install via aaPanel
```

### 2. Install Nginx via aaPanel

**Steps:**
1. Login to aaPanel: `http://YOUR_SERVER_IP:7800`
2. Go to: **App Store**
3. Search: **Nginx**
4. Click: **Install**
5. Select version: **Latest stable** (recommended)
6. Wait: ~2-5 minutes

**Verify:**
```bash
nginx -v
# Output: nginx version: nginx/1.24.0 (or similar)

systemctl status nginx
# Should be: active (running)
```

### 3. Configure Port Allocation

**Default Ports:**
- Apache: 80 (HTTP), 443 (HTTPS)
- Nginx: 800 (untuk CCTV app)

**Why Port 800?**
- Port 80 sudah digunakan Apache
- Port 800 mudah diingat
- Tidak conflict dengan service lain

**Alternative:** Jika ingin Nginx di port 80:
```bash
# Stop Apache
systemctl stop apache2
systemctl disable apache2

# Nginx akan otomatis bind ke port 80
```

### 4. Firewall Configuration

```bash
# Allow port 800 for Nginx
ufw allow 800/tcp

# Verify
ufw status
```

### 5. Run Installation Script

```bash
cd /var/www/cctv
bash deployment/aapanel-install.sh
```

Script akan:
- ✅ Check Nginx installed
- ✅ Setup backend, frontend, MediaMTX
- ✅ Configure PM2
- ⚠️ Nginx config manual via aaPanel UI

### 6. Configure Nginx via aaPanel UI

Follow: [AAPANEL_NGINX_SETUP.md](AAPANEL_NGINX_SETUP.md)

## Service Management

### Check Services

```bash
# Apache
systemctl status apache2

# Nginx
systemctl status nginx

# Backend
pm2 status

# MediaMTX
pm2 logs mediamtx
```

### Restart Services

```bash
# Apache
systemctl restart apache2

# Nginx
systemctl reload nginx

# Backend
pm2 restart cctv-backend

# MediaMTX
pm2 restart mediamtx
```

### Stop Apache (Optional)

Jika tidak digunakan:
```bash
systemctl stop apache2
systemctl disable apache2

# Nginx bisa dipindah ke port 80
# Edit via aaPanel UI: Website > Settings > Port
```

## Port Reference

| Service | Port | Access | Notes |
|---------|------|--------|-------|
| Apache | 80 | Public | Website lain |
| Apache SSL | 443 | Public | HTTPS website lain |
| Nginx | 800 | Public | CCTV Application |
| Backend API | 3000 | Internal | Fastify server |
| MediaMTX HLS | 8888 | Internal | HLS streaming |
| MediaMTX WebRTC | 8889 | Internal | WebRTC streaming |
| MediaMTX API | 9997 | Internal | Management API |
| aaPanel | 7800 | Public | aaPanel UI |

## Access URLs

**CCTV Application:**
- Frontend: `http://sicamdes.semarnet.id:800`
- Backend API: `http://api-sicamdes.semarnet.id:800`

**Other Websites (Apache):**
- `http://your-domain.com` (port 80)

## Troubleshooting

### Port Conflict

**Error:** `nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)`

**Solution:**
```bash
# Check what's using port 80
netstat -tlnp | grep :80

# If Apache, either:
# 1. Use different port for Nginx (800)
# 2. Stop Apache: systemctl stop apache2
```

### Nginx Not Starting

```bash
# Check config
nginx -t

# Check logs
tail -f /var/log/nginx/error.log

# Check aaPanel logs
tail -f /www/server/panel/logs/error.log
```

### Apache Not Starting

```bash
# Check config
apache2ctl configtest

# Check logs
tail -f /var/log/apache2/error.log
```

## Best Practices

### 1. Use Different Ports
- Apache: 80/443 (existing websites)
- Nginx: 800 (new applications)
- Clear separation, no conflicts

### 2. Monitor Resources
```bash
# Check memory
free -h

# Check CPU
top

# Check disk
df -h
```

### 3. Regular Backups
```bash
# Backup Apache configs
tar -czf apache-backup.tar.gz /etc/apache2/

# Backup Nginx configs
tar -czf nginx-backup.tar.gz /etc/nginx/

# Backup application
tar -czf cctv-backup.tar.gz /var/www/cctv/
```

### 4. SSL Certificates

**For Apache sites:**
- Use aaPanel UI: Website > SSL > Let's Encrypt

**For Nginx sites (CCTV):**
- Use aaPanel UI: Website > SSL > Let's Encrypt
- Or manual: `certbot --nginx -d sicamdes.semarnet.id`

## Performance Tips

### 1. Resource Allocation

**Apache:**
- Limit MaxRequestWorkers if not heavily used
- Edit: `/etc/apache2/mods-available/mpm_prefork.conf`

**Nginx:**
- Already optimized for reverse proxy
- RAM cache for HLS: `/dev/shm/nginx-cache`

### 2. Monitoring

```bash
# Apache connections
apache2ctl status

# Nginx connections
curl http://localhost/nginx_status

# PM2 monitoring
pm2 monit
```

## Migration Path

### From Apache to Nginx Only

If you want to migrate everything to Nginx:

1. **Backup Apache configs**
2. **Convert Apache vhosts to Nginx**
3. **Test Nginx configs**
4. **Stop Apache:** `systemctl stop apache2`
5. **Move Nginx to port 80**
6. **Update DNS if needed**

### Keep Both

Recommended for production:
- Apache: Existing websites (stable)
- Nginx: New applications (modern, efficient)
- Both can coexist peacefully

## Summary

✅ **Advantages:**
- No downtime for existing websites
- Nginx efficient for reverse proxy
- Easy to manage via aaPanel UI
- Clear port separation

⚠️ **Considerations:**
- More memory usage (2 web servers)
- Need to manage 2 services
- Port 800 in URLs (or use subdomain)

📚 **Next Steps:**
1. Install Nginx via aaPanel
2. Run installation script
3. Configure Nginx via aaPanel UI
4. Test both Apache and Nginx sites
5. Setup SSL certificates
6. Monitor performance

---

**Questions?** Check [AAPANEL_NGINX_SETUP.md](AAPANEL_NGINX_SETUP.md) for detailed Nginx configuration.
