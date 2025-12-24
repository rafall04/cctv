# RAF NET CCTV - Ubuntu 20.04 Compatibility Fix Guide

## 🎯 Overview

Panduan ini menyelesaikan semua masalah kompatibilitas RAF NET CCTV dengan Ubuntu 20.04. Masalah yang sering terjadi telah dianalisis dan diperbaiki melalui 5 fase yang terstruktur.

## 🔍 Masalah yang Diperbaiki

### 1. **System Dependencies Issues**
- ❌ Node.js versi tidak kompatibel
- ❌ Build tools tidak lengkap untuk native compilation
- ❌ Python symlinks untuk node-gyp
- ✅ **FIXED**: Node.js 18 LTS + build tools lengkap

### 2. **Backend Native Dependencies**
- ❌ better-sqlite3 compilation gagal
- ❌ bcrypt compilation gagal
- ❌ Database permission issues
- ✅ **FIXED**: Native compilation berhasil + database setup

### 3. **Frontend Build Issues**
- ❌ Vite build gagal
- ❌ Environment variables salah
- ❌ Static file serving issues
- ✅ **FIXED**: Production build optimized + environment fix

### 4. **MediaMTX Configuration**
- ❌ Time format `1d` tidak kompatibel (harus `24h`)
- ❌ Binary compatibility issues
- ❌ Port conflicts
- ✅ **FIXED**: Ubuntu 20.04 compatible config + stable version

### 5. **Nginx & PM2 Issues**
- ❌ Reverse proxy configuration
- ❌ Process management
- ❌ Service startup issues
- ✅ **FIXED**: Optimized nginx + PM2 ecosystem

## 🚀 Quick Start

### Option 1: Run All Phases (Recommended)
```bash
# Copy project files to /var/www/rafnet-cctv first
sudo mkdir -p /var/www/rafnet-cctv
sudo chown -R $USER:$USER /var/www/rafnet-cctv
cp -r * /var/www/rafnet-cctv/
cd /var/www/rafnet-cctv

# Run complete fix
bash deployment/ubuntu-20.04-complete-fix.sh
```

### Option 2: Run Individual Phases
```bash
bash deployment/ubuntu-20.04-fix-phase1.sh  # System Dependencies
bash deployment/ubuntu-20.04-fix-phase2.sh  # Backend Setup
bash deployment/ubuntu-20.04-fix-phase3.sh  # Frontend Build
bash deployment/ubuntu-20.04-fix-phase4.sh  # MediaMTX Setup
bash deployment/ubuntu-20.04-fix-phase5.sh  # Nginx & PM2
```

## 📋 Phase Details

### **Phase 1: System Dependencies & Build Environment**
- Updates Ubuntu 20.04 packages
- Installs Node.js 18 LTS
- Sets up build tools (gcc, python3, node-gyp)
- Configures npm for native compilation
- Tests compilation capability

### **Phase 2: Backend Dependencies & Database Setup**
- Installs backend dependencies with native compilation
- Fixes better-sqlite3 and bcrypt issues
- Sets up SQLite database with proper permissions
- Creates production environment configuration
- Tests backend functionality

### **Phase 3: Frontend Build & Configuration**
- Installs frontend dependencies
- Creates production environment variables
- Builds optimized production bundle
- Sets up static file serving
- Tests build integrity

### **Phase 4: MediaMTX Configuration & Setup**
- Downloads MediaMTX v1.8.5 (Ubuntu 20.04 compatible)
- Creates compatible configuration (24h instead of 1d)
- Sets up proper permissions
- Tests MediaMTX functionality
- Creates systemd service

### **Phase 5: Nginx & PM2 Final Configuration**
- Creates Ubuntu 20.04 optimized Nginx config
- Sets up PM2 ecosystem with proper process management
- Configures systemd integration
- Tests complete system integration
- Creates management scripts

## 🔧 Management Commands

After successful installation:

```bash
# System Management
./start-system.sh      # Start all services
./stop-system.sh       # Stop all services  
./restart-system.sh    # Restart all services
./status-system.sh     # Check system status

# PM2 Management
pm2 list              # List all processes
pm2 logs              # View all logs
pm2 logs backend      # View backend logs
pm2 logs mediamtx     # View MediaMTX logs

# Nginx Management
sudo nginx -t         # Test configuration
sudo systemctl status nginx  # Check status
sudo systemctl restart nginx # Restart nginx
```

## 🌐 Network Endpoints

After deployment:

- **Frontend**: http://cctv.raf.my.id
- **Backend API**: http://api-cctv.raf.my.id  
- **Backend Direct**: http://127.0.0.1:3000
- **MediaMTX API**: http://127.0.0.1:9997
- **HLS Streaming**: http://127.0.0.1:8888
- **WebRTC**: http://127.0.0.1:8889

## 🔒 Security Setup

### 1. Firewall Configuration
```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 1935/tcp    # RTMP
sudo ufw allow 8888/tcp    # HLS
sudo ufw allow 8889/tcp    # WebRTC
sudo ufw enable
```

### 2. SSL Certificate
```bash
sudo certbot --nginx
```

### 3. Change Default Credentials
- Login: admin / admin123
- Change immediately after first login

## 🔍 Troubleshooting

### Common Issues & Solutions

#### Backend Not Starting
```bash
pm2 logs rafnet-cctv-backend
# Check for database permissions or native dependency issues
```

#### MediaMTX Not Responding
```bash
pm2 logs mediamtx
# Check configuration and port conflicts
```

#### Nginx 502 Bad Gateway
```bash
sudo nginx -t
pm2 list
# Ensure backend is running on port 3000
```

#### Database Issues
```bash
ls -la backend/data/
# Check file permissions and ownership
```

## 📊 System Requirements

### Minimum Requirements
- **OS**: Ubuntu 20.04 LTS
- **RAM**: 1GB (2GB recommended)
- **Storage**: 5GB free space
- **CPU**: 1 core (2 cores recommended)

### Network Requirements
- **Ports**: 80, 443, 1935, 8888, 8889
- **Bandwidth**: 10Mbps+ for multiple camera streams

## 🎯 Production Checklist

- [ ] All 5 phases completed successfully
- [ ] DNS A records updated
- [ ] SSL certificates installed
- [ ] Firewall configured
- [ ] Default credentials changed
- [ ] Camera RTSP URLs configured
- [ ] System monitoring set up

## 📞 Support

If you encounter issues:

1. Check the specific phase logs
2. Run `./status-system.sh` for system overview
3. Check PM2 logs: `pm2 logs`
4. Verify Nginx config: `sudo nginx -t`
5. Check system resources: `free -h` and `df -h`

## 🔄 Updates

To update the system:
```bash
cd /var/www/rafnet-cctv
git pull origin main
bash deployment/ubuntu-20.04-fix-phase3.sh  # Rebuild frontend
./restart-system.sh
```