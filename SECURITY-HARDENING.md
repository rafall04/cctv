# Security Hardening Guide - RAF NET CCTV

## 🔒 Critical Security Issues Fixed

### Issues Detected
- ❌ `.env` files accessible publicly
- ❌ `.git/config` exposed
- ❌ `config.php.bak` and backup files accessible
- ❌ `database.sql` files exposed
- ❌ `.htaccess` files accessible
- ❌ `node_modules` directory accessible
- ❌ Source code files accessible

### Solutions Implemented

#### 1. Nginx Configuration (Primary Protection)
File: `deployment/nginx.conf`

**Blocked Access:**
- `.env` files (all variants)
- `.git` directory
- Backup files (`.bak`, `.backup`, `.old`, `.orig`, `.save`)
- Database files (`.sql`, `.db`, `.sqlite`)
- Config backups (`config.*.bak`)
- `.htaccess` and Apache configs
- Hidden files (except `.well-known` for SSL)
- `node_modules` directory
- Package files (`package.json`, `package-lock.json`)
- Source directories (`src`, `tests`, `.vscode`, `.idea`)

**Security Headers Added:**
- `X-Frame-Options: SAMEORIGIN` - Prevent clickjacking
- `X-Content-Type-Options: nosniff` - Prevent MIME sniffing
- `X-XSS-Protection: 1; mode=block` - Enable XSS protection
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` - Restrict geolocation, microphone, camera

#### 2. .htaccess Files (Backup Protection)
Files: `backend/.htaccess`, `frontend/.htaccess`

Provides backup protection if Nginx is misconfigured or disabled.

#### 3. Enhanced .gitignore
File: `.gitignore`

Prevents sensitive files from being committed to Git:
- All `.env` variants
- Database files
- Backup files
- SSH keys
- Certificates
- Config backups

## 🚀 Deployment Instructions

### Step 1: Update Nginx Configuration

```bash
# As root on Ubuntu 20.04
cd /var/www/rafnet-cctv

# Backup current config
cp /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-available/rafnet-cctv.backup

# Copy new config
cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv

# Test configuration
nginx -t

# If test passes, reload Nginx
systemctl reload nginx
```

### Step 2: Run Security Cleanup

```bash
# Make script executable
chmod +x deployment/security-cleanup.sh

# Run cleanup
./deployment/security-cleanup.sh
```

### Step 3: Test Security

```bash
# Make script executable
chmod +x deployment/security-test.sh

# Run security tests
./deployment/security-test.sh http://cctv.raf.my.id:800
```

## ✅ Verification Checklist

After deployment, verify these URLs return **404** or **403**:

### Frontend Domain (cctv.raf.my.id)
- [ ] `http://cctv.raf.my.id:800/.env`
- [ ] `http://cctv.raf.my.id:800/.git/config`
- [ ] `http://cctv.raf.my.id:800/config.php.bak`
- [ ] `http://cctv.raf.my.id:800/database.sql`
- [ ] `http://cctv.raf.my.id:800/.htaccess`
- [ ] `http://cctv.raf.my.id:800/node_modules/`
- [ ] `http://cctv.raf.my.id:800/package.json`

### Backend Domain (api-cctv.raf.my.id)
- [ ] `http://api-cctv.raf.my.id:800/.env`
- [ ] `http://api-cctv.raf.my.id:800/.git/config`
- [ ] `http://api-cctv.raf.my.id:800/backend/data/cctv.db`
- [ ] `http://api-cctv.raf.my.id:800/backend/server.js`
- [ ] `http://api-cctv.raf.my.id:800/node_modules/`

## 🔐 Additional Security Recommendations

### 1. File Permissions

```bash
# Set proper permissions for sensitive files
chmod 600 /var/www/rafnet-cctv/backend/.env
chmod 600 /var/www/rafnet-cctv/frontend/.env
chmod 600 /var/www/rafnet-cctv/backend/data/*.db

# Set directory permissions
chmod 755 /var/www/rafnet-cctv
chmod 755 /var/www/rafnet-cctv/frontend/dist
```

### 2. Remove Unnecessary Files

```bash
# Remove backup files
find /var/www/rafnet-cctv -name "*.bak" -delete
find /var/www/rafnet-cctv -name "*.backup" -delete
find /var/www/rafnet-cctv -name "*.old" -delete

# Remove SQL dumps
find /var/www/rafnet-cctv -name "*.sql" -delete

# Remove swap files
find /var/www/rafnet-cctv -name "*.swp" -delete
find /var/www/rafnet-cctv -name "*.swo" -delete
```

### 3. Firewall Configuration

```bash
# Allow only necessary ports
ufw allow 800/tcp   # HTTP (custom port)
ufw allow 443/tcp   # HTTPS (if using SSL)
ufw allow 22/tcp    # SSH

# Deny direct access to backend port
ufw deny 3000/tcp

# Deny direct access to MediaMTX ports
ufw deny 8888/tcp
ufw deny 8889/tcp
ufw deny 9997/tcp
```

### 4. SSL/TLS (Recommended)

```bash
# Install Certbot
apt install certbot python3-certbot-nginx

# Get SSL certificate
certbot --nginx -d cctv.raf.my.id -d api-cctv.raf.my.id

# Auto-renewal
certbot renew --dry-run
```

### 5. Regular Security Audits

```bash
# Run security test weekly
./deployment/security-test.sh http://cctv.raf.my.id:800

# Check for exposed files
./deployment/security-cleanup.sh

# Review Nginx logs for suspicious activity
tail -f /var/log/nginx/rafnet-cctv-*.access.log | grep -E "(\.env|\.git|\.bak|\.sql)"
```

## 🚨 Emergency Response

If sensitive files were exposed:

### 1. Immediate Actions

```bash
# Block all access immediately
systemctl stop nginx

# Run security cleanup
./deployment/security-cleanup.sh

# Update Nginx config
cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
nginx -t
systemctl start nginx
```

### 2. Rotate Credentials

```bash
# Change all passwords in .env
nano /var/www/rafnet-cctv/backend/.env

# Update:
# - JWT_SECRET
# - DATABASE credentials (if exposed)
# - API keys
# - CSRF_SECRET

# Restart backend
pm2 restart rafnet-cctv-backend
```

### 3. Check for Unauthorized Access

```bash
# Check access logs
grep -E "(\.env|\.git|\.bak|\.sql)" /var/log/nginx/rafnet-cctv-*.access.log

# Check for suspicious IPs
awk '{print $1}' /var/log/nginx/rafnet-cctv-*.access.log | sort | uniq -c | sort -rn | head -20
```

## 📋 Security Maintenance Schedule

### Daily
- Monitor access logs for suspicious activity
- Check application health

### Weekly
- Run security test script
- Review failed login attempts
- Check for new backup files

### Monthly
- Update dependencies (`npm audit`)
- Review and rotate API keys
- Update SSL certificates (if needed)
- Full security audit

## 🔗 References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Nginx Security Best Practices](https://nginx.org/en/docs/http/ngx_http_core_module.html#location)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

## ✅ Security Status

After implementing all fixes:
- ✅ Sensitive files blocked at Nginx level
- ✅ Backup protection with .htaccess
- ✅ Security headers implemented
- ✅ File permissions secured
- ✅ Automated testing available
- ✅ Emergency response procedures documented

**Your application is now properly secured against sensitive file exposure attacks.**
