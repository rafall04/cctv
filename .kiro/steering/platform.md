# Platform Compatibility & Deployment Rules

## Cross-Platform Compatibility

### Supported Platforms
- **Windows 10/11**: Development and production
- **Ubuntu 20.04**: Production deployment (primary target)

### Platform-Specific Considerations

#### Windows Development
- Use PowerShell or Command Prompt
- MediaMTX binary: `mediamtx.exe`
- Path separators: `\` (handled automatically by Node.js)
- Development ports: Standard (3000, 5173, 8888, 8889, 9997)

#### Ubuntu 20.04 Production
- **Root Access**: All deployment scripts assume root user access
- **No sudo required**: Scripts run directly as root
- MediaMTX binary: `mediamtx` (Linux binary)
- Service management: systemd
- Process management: PM2 with ecosystem.config.cjs

## Ubuntu 20.04 Specific Rules

### User Permissions
- **ALWAYS assume root access** - no `sudo` commands needed
- Scripts should run directly without permission escalation
- File ownership: root:root for all application files
- Service files: placed directly in `/etc/systemd/system/`

### Network Configuration
- **CORS Configuration**: Configure allowed origins di environment variables
- **Security Middleware**: Multi-layer security dengan rate limiting, CSRF, input sanitization
- **Backend CORS**: Set allowed origins di ALLOWED_ORIGINS environment variable
- **Frontend Proxy**: Vite proxy untuk development, Nginx proxy untuk production

### Directory Structure (Ubuntu 20.04)
```
/var/www/rafnet-cctv/           # Main application directory
├── backend/                    # Fastify API server
├── frontend/dist/              # Built React application
├── mediamtx/                   # MediaMTX streaming server
├── logs/                       # Application logs
└── data/                       # SQLite database and uploads
```

### Service Configuration
- **Backend Service**: `/etc/systemd/system/cctv-backend.service`
- **Frontend Service**: Served via Nginx
- **MediaMTX Service**: `/etc/systemd/system/cctv-mediamtx.service`
- **Process Manager**: PM2 for Node.js applications

## Environment Variables (Ubuntu 20.04)

### Backend (.env)
```env
# Ubuntu 20.04 Production Settings
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# CORS Configuration
CORS_ORIGIN=https://cctv.raf.my.id,http://cctv.raf.my.id,http://172.17.11.12
# Atau gunakan * untuk accept all (tidak recommended untuk production)

# Database
DATABASE_PATH=/var/www/rafnet-cctv/data/cctv.db

# MediaMTX
MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_HLS_URL_INTERNAL=http://localhost:8888
MEDIAMTX_WEBRTC_URL_INTERNAL=http://localhost:8889
PUBLIC_HLS_PATH=/hls
PUBLIC_WEBRTC_PATH=/webrtc
PUBLIC_STREAM_BASE_URL=https://cctv.raf.my.id

# Security
JWT_SECRET=production-secret-change-this-to-random-string
JWT_EXPIRATION=1h
JWT_REFRESH_EXPIRATION=7d

# Security Features
API_KEY_VALIDATION_ENABLED=true
API_KEY_SECRET=your-api-key-secret
CSRF_ENABLED=true
CSRF_SECRET=your-csrf-secret
RATE_LIMIT_ENABLED=true
RATE_LIMIT_PUBLIC=100
RATE_LIMIT_AUTH=30
RATE_LIMIT_ADMIN=60

# Brute Force Protection
BRUTE_FORCE_ENABLED=true
MAX_LOGIN_ATTEMPTS=5
MAX_IP_ATTEMPTS=10
LOCKOUT_DURATION_MINUTES=30
IP_BLOCK_DURATION_MINUTES=60

# Password Policy
PASSWORD_MIN_LENGTH=12
PASSWORD_MAX_AGE_DAYS=90
PASSWORD_HISTORY_COUNT=5

# Session Management
SESSION_ABSOLUTE_TIMEOUT_HOURS=24

# Audit Logging
AUDIT_LOG_RETENTION_DAYS=90

# Allowed Origins (comma-separated)
ALLOWED_ORIGINS=https://cctv.raf.my.id,http://cctv.raf.my.id,http://172.17.11.12

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_MONITORING_CHAT_ID=your-monitoring-chat-id
TELEGRAM_FEEDBACK_CHAT_ID=your-feedback-chat-id
```

### Frontend (.env)
```env
# Ubuntu 20.04 Production Settings
VITE_API_URL=https://cctv.raf.my.id
# Atau gunakan server IP
# VITE_API_URL=http://172.17.11.12
```

## Deployment Commands

### Windows (Development)
```powershell
# Backend
cd backend
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev

# MediaMTX
cd mediamtx
.\mediamtx.exe mediamtx.yml
```

### Ubuntu 20.04 (Production)
```bash
# As root user (no sudo needed)

# Install dependencies
apt update
apt install -y nodejs npm nginx

# Install PM2 globally
npm install -g pm2

# Deploy application
cd /var/www/rafnet-cctv
npm install --production

# Build frontend
cd frontend
npm run build

# Start services
pm2 start ecosystem.config.cjs
systemctl start cctv-mediamtx
systemctl enable cctv-mediamtx

# Configure Nginx
cp deployment/nginx.conf /etc/nginx/sites-available/cctv
ln -s /etc/nginx/sites-available/cctv /etc/nginx/sites-enabled/
systemctl restart nginx
```

## CORS Configuration Rules

### Windows Development
- Standard CORS with specific origins
- Allow localhost:5173, localhost:3000
- Configure di backend/server.js

### Ubuntu 20.04 Production
- **Configure allowed origins** di environment variables
- Set ALLOWED_ORIGINS dengan comma-separated list
- Example: `ALLOWED_ORIGINS=https://cctv.raf.my.id,http://172.17.11.12`
- CORS middleware akan validate origin dari request

### Backend CORS Settings (Ubuntu 20.04)
```javascript
// In backend/config/config.js
const parseAllowedOrigins = () => {
  const defaultOrigins = [
    'https://cctv.raf.my.id',
    'http://cctv.raf.my.id',
    'http://172.17.11.12',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:8080'
  ];
  
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  }
  
  return defaultOrigins;
};

export const config = {
  security: {
    allowedOrigins: parseAllowedOrigins(),
  },
};

// In backend/server.js
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

### Frontend Proxy Settings (Ubuntu 20.04)
```javascript
// In frontend/vite.config.js - Development only
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

## File Permissions (Ubuntu 20.04)

### Application Files
```bash
# Set ownership to root
chown -R root:root /var/www/rafnet-cctv

# Set appropriate permissions
chmod -R 755 /var/www/rafnet-cctv
chmod 644 /var/www/rafnet-cctv/backend/.env
chmod 600 /var/www/rafnet-cctv/data/cctv.db
```

### Service Files
```bash
# SystemD service files
chmod 644 /etc/systemd/system/cctv-*.service
systemctl daemon-reload
```

## Troubleshooting Rules

### CORS Issues (Ubuntu 20.04)
1. **First Solution**: Check ALLOWED_ORIGINS environment variable
2. **Second Solution**: Add origin ke allowed list
3. **Debug**: Check backend logs untuk rejected origins
4. **Verify**: Test dengan curl -H "Origin: https://your-domain.com"

### Permission Issues
- Always run as root in Ubuntu 20.04
- No permission escalation needed
- Files should be owned by root:root

### Network Issues
- Use `0.0.0.0` for host binding (not `localhost`)
- Ensure firewall allows required ports
- Test with `curl` from different machines

## Git Auto-Push Rules

### Automatic GitHub Push Policy
- **ALWAYS push changes to GitHub** after any file modifications
- **Auto-commit** with descriptive messages
- **Push immediately** to keep remote repository synchronized
- **Branch**: Push to current branch (usually `main` or `master`)

### Auto-Push Commands
```bash
# Standard auto-push sequence
git add .
git commit -m "Auto-update: [description of changes]"
git push origin main
```

### Auto-Push Scenarios
1. **After code changes**: Any modification to source files
2. **After configuration updates**: Environment files, configs
3. **After deployment scripts**: Any script modifications
4. **After documentation updates**: README, guides, steering files
5. **After dependency updates**: package.json, package-lock.json

### Platform-Specific Auto-Push

#### Windows (PowerShell)
```powershell
# Auto-push function
function Push-Changes {
    param([string]$message = "Auto-update: Windows development changes")
    
    git add .
    git commit -m $message
    git push origin main
    
    Write-Host "✅ Changes pushed to GitHub successfully" -ForegroundColor Green
}

# Usage after any changes
Push-Changes "Fix: Updated CORS configuration for Windows"
```

#### Ubuntu 20.04 (Bash)
```bash
# Auto-push function
auto_push() {
    local message="${1:-Auto-update: Ubuntu 20.04 production changes}"
    
    git add .
    git commit -m "$message"
    git push origin main
    
    echo "✅ Changes pushed to GitHub successfully"
}

# Usage after any changes
auto_push "Deploy: Updated Ubuntu 20.04 configuration"
```

### Commit Message Conventions
- **Fix**: Bug fixes and corrections
- **Feature**: New functionality
- **Update**: Configuration or dependency updates
- **Deploy**: Deployment-related changes
- **Docs**: Documentation updates
- **Auto-update**: General automatic updates

### Pre-Push Checks
```bash
# Ensure git is configured
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# Check git status before push
git status

# Verify remote repository
git remote -v
```

### Auto-Push Integration

#### In Development Workflow
1. Make code changes
2. Test changes locally
3. **Immediately run auto-push**
4. Continue development

#### In Deployment Scripts
```bash
#!/bin/bash
# At the end of any deployment script

echo "🔄 Auto-pushing changes to GitHub..."
git add .
git commit -m "Deploy: Ubuntu 20.04 deployment completed - $(date)"
git push origin main
echo "✅ Deployment changes pushed to GitHub"
```

#### In Package.json Scripts
```json
{
  "scripts": {
    "dev": "nodemon server.js",
    "push": "git add . && git commit -m 'Auto-update: Development changes' && git push origin main",
    "deploy-push": "git add . && git commit -m 'Deploy: Production deployment' && git push origin main"
  }
}
```

### Error Handling for Auto-Push
```bash
# Safe auto-push with error handling
safe_push() {
    local message="${1:-Auto-update: Changes}"
    
    # Check if there are changes to commit
    if [[ -n $(git status --porcelain) ]]; then
        git add .
        
        if git commit -m "$message"; then
            if git push origin main; then
                echo "✅ Successfully pushed: $message"
            else
                echo "❌ Failed to push to GitHub"
                return 1
            fi
        else
            echo "❌ Failed to commit changes"
            return 1
        fi
    else
        echo "ℹ️ No changes to push"
    fi
}
```

### GitHub Repository Requirements
- Repository must be initialized and connected
- Push access must be configured (SSH keys or token)
- Remote origin must be set correctly
- Branch protection rules should allow direct pushes

## Platform Detection

### In Node.js Code
```javascript
const isWindows = process.platform === 'win32';
const isUbuntu = process.platform === 'linux';

// Platform-specific paths
const mediamtxBinary = isWindows ? './mediamtx.exe' : './mediamtx';
const dbPath = isWindows ? './data/cctv.db' : '/var/www/rafnet-cctv/data/cctv.db';
```

### In Shell Scripts
```bash
# Detect platform
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Ubuntu/Linux
    MEDIAMTX_BINARY="./mediamtx"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    # Windows
    MEDIAMTX_BINARY="./mediamtx.exe"
fi
```