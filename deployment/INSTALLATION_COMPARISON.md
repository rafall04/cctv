# RAF NET CCTV - Installation Methods Comparison

## 📊 Quick Comparison

| Method | Setup Time | Difficulty | Best For | Resource Usage |
|--------|-----------|------------|----------|----------------|
| **Docker** | 5-10 min | ⭐ Easy | Quick setup, testing, dev | Medium (+200MB) |
| **aaPanel** | 10-15 min | ⭐⭐ Medium | Managed hosting, GUI lovers | Low |
| **Manual** | 20-30 min | ⭐⭐⭐ Hard | Full control, production | Lowest |

## 🐳 Method 1: Docker (Recommended for Quick Start)

### Pros
✅ One-command installation  
✅ Isolated environment  
✅ Easy updates (`docker-compose up -d --build`)  
✅ Works on any OS (Linux, Windows, macOS)  
✅ Easy rollback  
✅ Consistent across environments  

### Cons
❌ +100-200MB RAM overhead  
❌ Requires Docker knowledge for debugging  
❌ Extra layer of abstraction  

### Installation

```bash
# One command
curl -fsSL https://raw.githubusercontent.com/rafall04/cctv/main/deployment/docker-install.sh | sudo bash

# Or manual
git clone https://github.com/rafall04/cctv.git /var/www/rafnet-cctv
cd /var/www/rafnet-cctv
docker-compose up -d --build
```

### Management

```bash
# Status
docker-compose ps

# Logs
docker-compose logs -f

# Restart
docker-compose restart

# Update
git pull && docker-compose up -d --build
```

### When to Use
- Quick testing/demo
- Development environment
- Multiple deployments on same server
- Team collaboration (consistent environment)
- CI/CD pipelines

**Full Guide:** [DOCKER_SETUP.md](DOCKER_SETUP.md)

---

## 🎛️ Method 2: aaPanel (Recommended for Managed Hosting)

### Pros
✅ GUI management (no terminal needed)  
✅ Built-in Nginx/Apache management  
✅ SSL certificate automation  
✅ File manager, database viewer  
✅ Resource monitoring  
✅ Backup tools  

### Cons
❌ Requires aaPanel installation  
❌ Some manual configuration needed  
❌ Less control than manual setup  

### Installation

```bash
# Install aaPanel first (if not installed)
wget -O install.sh http://www.aapanel.com/script/install-ubuntu_6.0_en.sh
sudo bash install.sh

# Then install CCTV
cd /tmp
wget https://raw.githubusercontent.com/rafall04/cctv/main/deployment/aapanel-install.sh
sudo bash aapanel-install.sh
```

### Post-Installation (via aaPanel UI)

1. **Add Website**
   - Domain: `cctv.yourdomain.com`
   - Port: `800`
   - Root: `/var/www/cctv/frontend/dist`

2. **Configure Reverse Proxy**
   - `/api` → `http://localhost:3000`
   - `/hls` → `http://localhost:3000` (NOT 8888!)

3. **Enable SSL** (optional)
   - Click "SSL" tab
   - Select "Let's Encrypt"
   - Apply

### Management

**Via aaPanel UI:**
- Website management
- SSL certificates
- File manager
- Database viewer
- Resource monitoring

**Via Terminal:**
```bash
pm2 status
pm2 logs cctv-backend
pm2 restart cctv-backend
```

### When to Use
- Prefer GUI over terminal
- Shared hosting environment
- Managing multiple websites
- Non-technical team members
- Need built-in backup tools

**Full Guide:** [AAPANEL_QUICK_SETUP.md](AAPANEL_QUICK_SETUP.md)

---

## 🔧 Method 3: Manual Installation (Recommended for Production)

### Pros
✅ Full control over every component  
✅ Lowest resource usage  
✅ Direct access to logs  
✅ No extra layers  
✅ Best performance  

### Cons
❌ Longest setup time  
❌ Requires Linux knowledge  
❌ Manual dependency management  
❌ More commands for updates  

### Installation

```bash
# 1. Install dependencies
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs nginx sqlite3 ffmpeg git

# 2. Install PM2
sudo npm install -g pm2

# 3. Clone repository
git clone https://github.com/rafall04/cctv.git /var/www/rafnet-cctv
cd /var/www/rafnet-cctv

# 4. Setup backend
cd backend
npm install --production
cp .env.example .env
nano .env  # Edit configuration
npm run setup-db
cd ..

# 5. Setup frontend
cd frontend
npm install
nano .env  # Edit configuration
npm run build
cd ..

# 6. Setup MediaMTX
cd mediamtx
wget https://github.com/bluenviron/mediamtx/releases/download/v1.9.0/mediamtx_v1.9.0_linux_amd64.tar.gz
tar -xzf mediamtx_v1.9.0_linux_amd64.tar.gz
chmod +x mediamtx
cd ..

# 7. Configure Nginx
sudo cp deployment/nginx.conf /etc/nginx/sites-available/rafnet-cctv
sudo ln -s /etc/nginx/sites-available/rafnet-cctv /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 8. Start services
pm2 start deployment/ecosystem.config.cjs
pm2 save
pm2 startup
```

### Management

```bash
# Status
pm2 status

# Logs
pm2 logs rafnet-cctv-backend
pm2 logs mediamtx

# Restart
pm2 restart rafnet-cctv-backend

# Update
cd /var/www/rafnet-cctv
git pull origin main
cd frontend && npm run build
pm2 restart rafnet-cctv-backend
```

### When to Use
- Production environment
- Maximum performance needed
- Full control required
- Experienced Linux admin
- Custom server configuration

**Full Guide:** [README.md](../README.md)

---

## 🔄 Migration Between Methods

### Docker → Manual

```bash
# 1. Backup data
docker cp rafnet-cctv:/app/backend/data/cctv.db ./cctv.db
docker cp rafnet-cctv:/app/recordings ./recordings

# 2. Stop Docker
docker-compose down

# 3. Install manually (see Method 3)

# 4. Restore data
cp cctv.db /var/www/rafnet-cctv/backend/data/
cp -r recordings /var/www/rafnet-cctv/
```

### Manual → Docker

```bash
# 1. Backup data
cp /var/www/rafnet-cctv/backend/data/cctv.db ./cctv.db
cp -r /var/www/rafnet-cctv/recordings ./recordings

# 2. Stop PM2
pm2 delete all

# 3. Install Docker (see Method 1)

# 4. Restore data
docker cp cctv.db rafnet-cctv:/app/backend/data/
docker cp recordings rafnet-cctv:/app/
```

### aaPanel → Docker

```bash
# 1. Backup via aaPanel UI or terminal
cp /var/www/cctv/backend/data/cctv.db ./cctv.db

# 2. Stop services
pm2 delete all

# 3. Install Docker (see Method 1)

# 4. Restore data
docker cp cctv.db rafnet-cctv:/app/backend/data/
```

---

## 🎯 Decision Guide

### Choose Docker if:
- ✅ You want the fastest setup
- ✅ You're testing or developing
- ✅ You need multiple environments
- ✅ You want easy updates
- ✅ You have 2GB+ RAM available

### Choose aaPanel if:
- ✅ You prefer GUI over terminal
- ✅ You manage multiple websites
- ✅ You want built-in tools (SSL, backup, monitoring)
- ✅ You're on shared hosting
- ✅ You have non-technical team members

### Choose Manual if:
- ✅ You need maximum performance
- ✅ You want full control
- ✅ You're experienced with Linux
- ✅ You're deploying to production
- ✅ You have tight resource constraints

---

## 📋 Feature Comparison

| Feature | Docker | aaPanel | Manual |
|---------|--------|---------|--------|
| **Installation** |
| Setup Time | 5-10 min | 10-15 min | 20-30 min |
| One Command | ✅ Yes | ✅ Yes | ❌ No |
| Auto Dependencies | ✅ Yes | ⚠️ Partial | ❌ No |
| **Management** |
| GUI Available | ❌ No | ✅ Yes | ❌ No |
| Update Command | 1 command | 2-3 commands | 4-5 commands |
| Rollback | ✅ Easy | ⚠️ Manual | ⚠️ Manual |
| **Performance** |
| RAM Usage | +200MB | Normal | Lowest |
| CPU Overhead | +5% | Normal | Lowest |
| Disk Usage | +500MB | Normal | Lowest |
| **Features** |
| SSL Management | Manual | ✅ GUI | Manual |
| Backup Tools | Manual | ✅ Built-in | Manual |
| Monitoring | Docker stats | ✅ Built-in | Manual |
| File Manager | ❌ No | ✅ Yes | ❌ No |
| **Debugging** |
| Log Access | Container logs | Direct + GUI | Direct |
| Shell Access | `docker exec` | Direct + GUI | Direct |
| Complexity | Medium | Low | Low |

---

## 🚀 Quick Start Commands

### Docker
```bash
curl -fsSL https://raw.githubusercontent.com/rafall04/cctv/main/deployment/docker-install.sh | sudo bash
```

### aaPanel
```bash
wget https://raw.githubusercontent.com/rafall04/cctv/main/deployment/aapanel-install.sh
sudo bash aapanel-install.sh
```

### Manual
```bash
git clone https://github.com/rafall04/cctv.git /var/www/rafnet-cctv
cd /var/www/rafnet-cctv
# Follow README.md
```

---

## 📚 Documentation Links

- **Docker Setup:** [DOCKER_SETUP.md](DOCKER_SETUP.md)
- **aaPanel Setup:** [AAPANEL_QUICK_SETUP.md](AAPANEL_QUICK_SETUP.md)
- **Manual Setup:** [../README.md](../README.md)
- **Troubleshooting:** [../README.md#troubleshooting](../README.md#troubleshooting)

---

**Made with ❤️ by RAF NET**
