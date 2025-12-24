# 🚀 Quick Start Guide - RAF NET CCTV Hub

This guide will help you get the RAF NET CCTV system up and running quickly.

## ✅ Prerequisites Installed

- ✓ Node.js 18+
- ✓ Backend dependencies installed
- ✓ Frontend dependencies installed
- ✓ Database initialized with sample data

## 📝 Default Credentials

**Admin Login:**
- Username: `admin`
- Password: `admin123`
- ⚠️ **IMPORTANT**: Change this password immediately in production!

## 🎯 Quick Start (3 Steps)

### Step 1: Start Backend Server

```powershell
cd backend
npm run dev
```

**Expected output:**
```
🚀 RAF NET CCTV Backend Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Server: http://0.0.0.0:3000
🔧 Environment: development
📊 Health Check: http://0.0.0.0:3000/health
```

**Test it:**
```powershell
# In a new terminal
curl http://localhost:3000/health
```

### Step 2: Start Frontend Development Server

```powershell
# In a new terminal
cd frontend
npm run dev
```

**Expected output:**
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

**Open in browser:**
- Public view: http://localhost:5173
- Admin login: http://localhost:5173/admin/login

### Step 3: Configure MediaMTX (Optional for testing)

**For testing without real cameras**, you can skip MediaMTX for now. The frontend will show camera cards but streams won't play.

**To test with real cameras:**

1. Download MediaMTX:
   ```powershell
   # Download from: https://github.com/bluenviron/mediamtx/releases
   # Extract to: c:\project\cctv\mediamtx\
   ```

2. Update camera RTSP URLs:
   - Login to admin panel: http://localhost:5173/admin/login
   - Go to camera management
   - Edit each camera and update RTSP URL to match your cameras

3. Start MediaMTX:
   ```powershell
   cd mediamtx
   .\mediamtx.exe mediamtx.yml
   ```

## 🎨 What You'll See

### Public Landing Page (http://localhost:5173)

- **Header**: RAF NET CCTV logo and "Admin" button
- **Camera Grid**: 3 sample cameras (Front Entrance, Parking Lot, Lobby)
- **Video Players**: Will show "Stream Unavailable" until MediaMTX is configured
- **Design**: Dark mode with glassmorphism effects

### Admin Panel (http://localhost:5173/admin/login)

1. **Login Page**:
   - Enter username: `admin`
   - Enter password: `admin123`
   - Click "Login"

2. **Camera Management**:
   - View all cameras (including disabled ones)
   - Add new cameras
   - Edit camera details (name, RTSP URL, location, description)
   - Enable/disable cameras (controls public visibility)
   - Delete cameras

## 🧪 Testing Without Real Cameras

The system is fully functional without MediaMTX:

1. ✅ **Backend API**: All endpoints work
2. ✅ **Admin Panel**: Full camera management
3. ✅ **Public Page**: Shows camera grid
4. ❌ **Video Streams**: Won't play (need MediaMTX + real cameras)

## 📊 Sample Data

The database includes 3 sample cameras:

| Name | Location | RTSP URL (placeholder) |
|------|----------|------------------------|
| Front Entrance | Building A - Front | rtsp://192.168.1.100:554/stream |
| Parking Lot | Building A - Parking | rtsp://192.168.1.101:554/stream |
| Lobby | Building A - Lobby | rtsp://192.168.1.102:554/stream |

**Update these in the admin panel to match your actual cameras!**

## 🔧 Common Tasks

### Change Admin Password

1. Login to admin panel
2. Currently, password change is not in UI
3. Manually update in database:

```powershell
cd backend
node
```

```javascript
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const db = new Database('./data/cctv.db');

const newPassword = 'YourNewSecurePassword123!';
const hash = await bcrypt.hash(newPassword, 10);

db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
  .run(hash, 'admin');

console.log('Password updated!');
process.exit();
```

### Add a New Camera

1. Login to admin panel
2. Click "Add Camera" button
3. Fill in:
   - **Name**: e.g., "Back Door"
   - **RTSP URL**: e.g., `rtsp://192.168.1.103:554/stream`
   - **Location**: e.g., "Building B - Rear Entrance"
   - **Description**: Optional
   - **Enable**: Check to make visible on public page
4. Click "Add Camera"

### View API Endpoints

Backend is running at http://localhost:3000

**Public endpoints (no auth):**
- `GET /health` - Health check
- `GET /api/cameras/active` - List enabled cameras
- `GET /api/stream` - Get all active streams
- `GET /api/stream/:cameraId` - Get stream URLs for camera

**Admin endpoints (requires JWT):**
- `POST /api/auth/login` - Admin login
- `GET /api/cameras` - List all cameras
- `POST /api/cameras` - Create camera
- `PUT /api/cameras/:id` - Update camera
- `DELETE /api/cameras/:id` - Delete camera

### Test API with curl

```powershell
# Get active cameras (public)
curl http://localhost:3000/api/cameras/active

# Login (get JWT token)
curl -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"username":"admin","password":"admin123"}'

# Get all cameras (admin - need token from login)
curl http://localhost:3000/api/cameras `
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## 🐛 Troubleshooting

### Backend won't start

**Error**: `Cannot find module`
```powershell
cd backend
npm install
```

### Frontend won't start

**Error**: `Cannot find module`
```powershell
cd frontend
npm install
```

### Database error

**Error**: `SQLITE_ERROR: no such table`
```powershell
cd backend
npm run setup-db
```

### CORS errors in browser

Check `backend/.env`:
```env
CORS_ORIGIN=http://localhost:5173,http://localhost:3000
```

### Video player shows "Stream Unavailable"

This is expected without MediaMTX. To fix:
1. Install and configure MediaMTX
2. Update camera RTSP URLs to match your cameras
3. Ensure cameras are accessible from MediaMTX host

## 📚 Next Steps

1. ✅ **Test the system** - Try adding/editing cameras in admin panel
2. 🔒 **Change admin password** - Use the method above
3. 📹 **Configure real cameras** - Update RTSP URLs in admin panel
4. 🎥 **Set up MediaMTX** - For live streaming
5. 🌐 **Deploy to production** - See README.md for deployment guide

## 🆘 Need Help?

- **Documentation**: See `README.md` for full documentation
- **Security**: See `SECURITY.md` for security best practices
- **API Reference**: Backend server shows all endpoints on startup

---

**You're all set!** 🎉

Open http://localhost:5173 to see your CCTV system in action!
