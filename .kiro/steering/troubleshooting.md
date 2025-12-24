# Troubleshooting Guide & Common Issues

## Common Development Issues

### Backend Issues

#### 1. Database Connection Errors
```bash
# Error: SQLITE_CANTOPEN: unable to open database file
# Solution: Check database path and permissions

# Windows
mkdir backend\data
# Ubuntu 20.04 (as root)
mkdir -p /var/www/rafnet-cctv/data
chown root:root /var/www/rafnet-cctv/data
chmod 755 /var/www/rafnet-cctv/data
```

#### 2. MediaMTX Connection Refused
```bash
# Error: connect ECONNREFUSED 127.0.0.1:9997
# Solution: Ensure MediaMTX is running

# Check if MediaMTX is running
curl http://localhost:9997/v3/config/global/get

# Start MediaMTX
cd mediamtx
# Windows
.\mediamtx.exe mediamtx.yml
# Ubuntu 20.04
./mediamtx mediamtx.yml
```

#### 3. JWT Token Issues
```javascript
// Error: JsonWebTokenError: invalid token
// Solution: Check JWT secret configuration

// In backend/config/config.js
export const config = {
    jwt: {
        secret: process.env.JWT_SECRET || 'development-secret-change-in-production',
        expiration: process.env.JWT_EXPIRATION || '24h',
    }
};

// Verify token in browser DevTools
localStorage.getItem('token');
```

#### 4. CORS Errors (Development)
```javascript
// Error: Access to fetch at 'http://localhost:3000/api/cameras' from origin 'http://localhost:5173' has been blocked by CORS policy

// Solution: Update backend CORS configuration
// In backend/server.js
await fastify.register(cors, {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
});
```

### Frontend Issues

#### 1. Video Stream Not Loading
```jsx
// Error: GET http://localhost:8888/camera1/index.m3u8 net::ERR_CONNECTION_REFUSED

// Troubleshooting steps:
// 1. Check MediaMTX is running on port 8888
// 2. Verify camera RTSP URL is correct
// 3. Check MediaMTX configuration

// Debug VideoPlayer component
function VideoPlayer({ streamUrl }) {
    useEffect(() => {
        console.log('Stream URL:', streamUrl);
        
        // Test stream URL directly
        fetch(streamUrl)
            .then(response => {
                console.log('Stream response:', response.status);
            })
            .catch(error => {
                console.error('Stream error:', error);
            });
    }, [streamUrl]);
}
```

#### 2. HLS.js Errors
```jsx
// Error: HLS.js error: manifestLoadError

// Solution: Proper error handling
useEffect(() => {
    if (Hls.isSupported() && streamUrl) {
        const hls = new Hls({
            enableWorker: false,
            lowLatencyMode: true,
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS Error:', data);
            
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('Network error, trying to recover...');
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('Media error, trying to recover...');
                        hls.recoverMediaError();
                        break;
                    default:
                        console.log('Fatal error, destroying HLS instance');
                        hls.destroy();
                        break;
                }
            }
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(videoRef.current);
    }
}, [streamUrl]);
```

#### 3. Build Errors
```bash
# Error: Module not found: Can't resolve 'hls.js'
npm install hls.js

# Error: Failed to resolve import "axios"
npm install axios

# Error: Vite build fails with memory issues
# Solution: Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm run build
```

## Ubuntu 20.04 Specific Issues

### 1. Permission Denied Errors
```bash
# Error: EACCES: permission denied, open '/var/www/rafnet-cctv/data/cctv.db'
# Solution: Fix ownership and permissions (as root)

chown -R root:root /var/www/rafnet-cctv
chmod -R 755 /var/www/rafnet-cctv
chmod 644 /var/www/rafnet-cctv/backend/.env
chmod 600 /var/www/rafnet-cctv/data/cctv.db
```

### 2. Node.js Version Issues
```bash
# Error: Node.js version too old
# Solution: Install Node.js 18+

# Remove old Node.js
apt remove nodejs npm

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify version
node --version  # Should be v20.x.x or higher
npm --version
```

### 3. PM2 Process Issues
```bash
# Error: PM2 process not starting
# Solution: Check PM2 configuration

# View PM2 logs
pm2 logs cctv-backend

# Restart PM2 processes
pm2 restart ecosystem.config.cjs

# Check PM2 status
pm2 status

# If PM2 not found
npm install -g pm2
```

### 4. Nginx Configuration Issues
```bash
# Error: 502 Bad Gateway
# Solution: Check Nginx configuration and backend status

# Test Nginx configuration
nginx -t

# Check if backend is running
curl http://localhost:3000/health

# View Nginx error logs
tail -f /var/log/nginx/error.log

# Restart Nginx
systemctl restart nginx
```

### 5. Firewall Issues
```bash
# Error: Connection timeout from external clients
# Solution: Configure firewall

# Check firewall status
ufw status

# Allow required ports
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 3000/tcp  # Backend API
ufw allow 8888/tcp  # MediaMTX HLS
ufw allow 8889/tcp  # MediaMTX WebRTC

# Enable firewall
ufw enable
```

## MediaMTX Issues

### 1. RTSP Connection Failed
```yaml
# Error: RTSP source connection failed
# Solution: Check camera connectivity and credentials

# Test RTSP URL manually
ffplay rtsp://admin:password@192.168.1.100:554/stream

# Update MediaMTX configuration
paths:
  camera1:
    source: rtsp://admin:password@192.168.1.100:554/stream
    sourceOnDemand: true
    runOnDemand: ffmpeg -re -stream_loop -1 -i rtsp://admin:password@192.168.1.100:554/stream -c copy -f rtsp rtsp://localhost:$RTSP_PORT/$MTX_PATH
```

### 2. High CPU Usage
```yaml
# Solution: Optimize MediaMTX configuration
# In mediamtx.yml

# Reduce log level
logLevel: warn

# Enable hardware acceleration if available
paths:
  camera1:
    source: rtsp://admin:password@192.168.1.100:554/stream
    sourceOnDemand: true
    runOnDemandCloseAfter: 10s  # Close stream after 10s of no viewers
```

### 3. Stream Quality Issues
```yaml
# Solution: Adjust stream parameters
paths:
  camera1:
    source: rtsp://admin:password@192.168.1.100:554/stream
    sourceOnDemand: true
    # Add transcoding for better compatibility
    runOnDemand: ffmpeg -re -i rtsp://admin:password@192.168.1.100:554/stream -c:v libx264 -preset ultrafast -tune zerolatency -c:a aac -f rtsp rtsp://localhost:$RTSP_PORT/$MTX_PATH
```

## Network Issues

### 1. CORS Issues in Production (Ubuntu 20.04)
```javascript
// Problem: CORS blocking requests in production
// Solution: Disable CORS filtering entirely

// In backend/config/config.js
export const config = {
    cors: {
        origin: true,  // Accept all origins
        credentials: true,
    }
};

// Alternative: Don't register CORS plugin at all
// Comment out this line in server.js:
// await fastify.register(cors, config.cors);
```

### 2. API Endpoint Not Found
```bash
# Error: 404 Not Found for API endpoints
# Solution: Check route registration and Nginx configuration

# Test backend directly
curl http://localhost:3000/api/cameras/active

# Check Nginx proxy configuration
# In /etc/nginx/sites-available/cctv
location /api {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
}
```

### 3. WebSocket Connection Issues
```javascript
// Error: WebSocket connection failed
// Solution: Ensure proper WebSocket proxy configuration

// In Nginx configuration
location /ws {
    proxy_pass http://localhost:8889;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

## Database Issues

### 1. Database Locked Error
```javascript
// Error: SQLITE_BUSY: database is locked
// Solution: Implement proper connection management

import Database from 'better-sqlite3';

const db = new Database('./data/cctv.db', {
    timeout: 5000,  // 5 second timeout
    verbose: console.log  // Enable logging in development
});

// Set WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
```

### 2. Database Corruption
```bash
# Error: SQLITE_CORRUPT: database disk image is malformed
# Solution: Backup and restore database

# Backup current database
cp /var/www/rafnet-cctv/data/cctv.db /var/www/rafnet-cctv/data/cctv.db.backup

# Try to repair
sqlite3 /var/www/rafnet-cctv/data/cctv.db ".recover" | sqlite3 /var/www/rafnet-cctv/data/cctv_recovered.db

# If repair fails, reinitialize database
cd /var/www/rafnet-cctv/backend
npm run setup-db
```

## Performance Issues

### 1. High Memory Usage
```javascript
// Solution: Implement proper cleanup and memory management

// In VideoPlayer component
useEffect(() => {
    return () => {
        // Cleanup HLS instance
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        
        // Cleanup video element
        if (videoRef.current) {
            videoRef.current.src = '';
            videoRef.current.load();
        }
    };
}, []);
```

### 2. Slow Database Queries
```javascript
// Solution: Add database indexes and optimize queries

// In database setup
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cameras_enabled ON cameras(enabled);
    CREATE INDEX IF NOT EXISTS idx_cameras_created_at ON cameras(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
`);

// Use prepared statements
const getActiveCamerasStmt = db.prepare(`
    SELECT id, name, description, location 
    FROM cameras 
    WHERE enabled = 1 
    ORDER BY id ASC
`);
```

## Debugging Tools

### 1. Backend Debugging
```javascript
// Enable debug logging
// In backend/.env
NODE_ENV=development
LOG_LEVEL=debug

// Add request logging middleware
fastify.addHook('onRequest', async (request) => {
    console.log(`${request.method} ${request.url}`, {
        headers: request.headers,
        query: request.query,
        body: request.body
    });
});
```

### 2. Frontend Debugging
```jsx
// Add debug information to components
function CameraGrid() {
    const [cameras, setCameras] = useState([]);
    
    useEffect(() => {
        console.log('CameraGrid mounted');
        console.log('API URL:', import.meta.env.VITE_API_URL);
    }, []);
    
    useEffect(() => {
        console.log('Cameras updated:', cameras);
    }, [cameras]);
}
```

### 3. Network Debugging
```bash
# Test API endpoints
curl -v http://localhost:3000/health
curl -v http://localhost:3000/api/cameras/active

# Test MediaMTX
curl -v http://localhost:9997/v3/config/global/get
curl -v http://localhost:8888/camera1/index.m3u8

# Monitor network traffic
netstat -tulpn | grep :3000
netstat -tulpn | grep :8888
```

## Recovery Procedures

### 1. Complete System Reset
```bash
# Ubuntu 20.04 - Full reset procedure (as root)

# Stop all services
pm2 stop all
systemctl stop nginx
pkill -f mediamtx

# Backup current data
cp -r /var/www/rafnet-cctv/data /var/www/rafnet-cctv/data.backup.$(date +%Y%m%d_%H%M%S)

# Reinstall dependencies
cd /var/www/rafnet-cctv/backend
npm install --production

cd /var/www/rafnet-cctv/frontend
npm install
npm run build

# Reinitialize database
cd /var/www/rafnet-cctv/backend
npm run setup-db

# Restart services
pm2 start ecosystem.config.cjs
systemctl start nginx
cd /var/www/rafnet-cctv/mediamtx && ./mediamtx mediamtx.yml &
```

### 2. Emergency Rollback
```bash
# If deployment fails, rollback to previous version
git log --oneline -10  # Find previous commit
git reset --hard <previous-commit-hash>

# Restore database backup if needed
cp /var/www/rafnet-cctv/data.backup.*/cctv.db /var/www/rafnet-cctv/data/cctv.db

# Restart services
pm2 restart all
systemctl restart nginx
```

This troubleshooting guide covers the most common issues encountered during development and deployment of the RAF NET CCTV system.