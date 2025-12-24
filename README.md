# RAF NET Secure CCTV Hub

A secure, high-performance video streaming system that isolates private IP cameras from public exposure while providing public web access to camera streams via MediaMTX, Fastify, and React.

## 🎯 Features

- **Public Camera Viewing**: Anyone can view all CCTV streams on the landing page without authentication
- **Admin Panel**: Secure JWT-based authentication for camera management (add/edit/delete cameras, configure RTSP URLs)
- **Private IP Protection**: Camera RTSP URLs never exposed to client browsers
- **Low Latency Streaming**: WebRTC for real-time viewing with HLS fallback
- **Modern UI**: Dark mode, glassmorphism effects, and responsive design
- **Auto-Reconnect**: Intelligent stream reconnection on network interruptions

## 🏗️ Architecture

```
End User → [Public Landing Page] → MediaMTX (WebRTC/HLS) → Private RTSP Cameras
Admin → [Login] → [Admin Panel] → Fastify API → SQLite → MediaMTX Management
```

### Components

1. **MediaMTX**: RTSP to WebRTC/HLS transcoding (public streams)
2. **Fastify Backend**: REST API for camera management (admin-only) and public camera listing
3. **SQLite Database**: Admin users, camera configurations, audit logs
4. **React Frontend**: Public landing page + admin panel

## 📋 Prerequisites

- **Node.js** 18+ (for backend and frontend)
- **MediaMTX** v1.x ([Download](https://github.com/bluenviron/mediamtx/releases))
- **Private Network**: Cameras on isolated VLAN accessible only to MediaMTX host

## 🚀 Installation

### 1. Clone Repository

```bash
git clone <repository-url>
cd cctv
```

### 2. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm run setup-db  # Initialize SQLite database
npm run dev       # Start development server
```

### 3. Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env with backend API URL
npm run dev       # Start development server
```

### 4. MediaMTX Setup

Download MediaMTX binary and place in `mediamtx/` directory:

```bash
cd mediamtx
# Copy mediamtx binary here
cp mediamtx.yml.example mediamtx.yml
# Edit mediamtx.yml with your camera RTSP URLs
./mediamtx mediamtx.yml
```

## ⚙️ Configuration

### Backend Environment Variables

```env
PORT=3000
HOST=0.0.0.0
JWT_SECRET=your-secret-key-change-this
JWT_EXPIRATION=24h
MEDIAMTX_API_URL=http://localhost:9997
DATABASE_PATH=./data/cctv.db
```

### Frontend Environment Variables

```env
VITE_API_URL=http://localhost:3000
```

### MediaMTX Configuration

Edit `mediamtx/mediamtx.yml` to add your cameras:

```yaml
paths:
  camera1:
    source: rtsp://192.168.1.100:554/stream
  camera2:
    source: rtsp://192.168.1.101:554/stream
```

## 🔐 Security

### Camera IP Isolation

- Camera RTSP URLs are stored **server-side only** in SQLite
- Frontend **never** receives RTSP URLs
- MediaMTX ingests from private network, exposes only WebRTC/HLS

### Admin Access

- Admin panel requires JWT authentication
- Passwords hashed with bcrypt
- Audit logging for all admin actions

### Public Access

- Camera streams are publicly accessible (no authentication)
- Only **enabled** cameras appear on public landing page
- Admins can disable cameras to hide from public view

## 📱 Usage

### Public Users

1. Visit `http://localhost:5173` (or your domain)
2. View all enabled cameras on the landing page
3. Click any camera to view stream

### Administrators

1. Visit `http://localhost:5173/admin/login`
2. Login with admin credentials
3. Manage cameras (add/edit/delete)
4. Enable/disable camera visibility

## 🛠️ Development

### Project Structure

```
cctv/
├── backend/              # Fastify API server
│   ├── config/          # Configuration files
│   ├── controllers/     # Route controllers
│   ├── database/        # SQLite setup and queries
│   ├── middleware/      # Auth and validation middleware
│   ├── routes/          # API routes
│   ├── services/        # Business logic (MediaMTX integration)
│   └── server.js        # Entry point
├── frontend/            # React SPA
│   ├── src/
│   │   ├── components/  # Reusable components
│   │   ├── pages/       # Page components
│   │   ├── services/    # API clients
│   │   └── App.jsx      # Main app component
│   └── vite.config.js
├── mediamtx/            # MediaMTX configuration
│   └── mediamtx.yml     # Stream configuration
└── README.md
```

### API Endpoints

#### Public Endpoints (No Auth)

- `GET /api/cameras/active` - List all enabled cameras
- `GET /api/stream/:cameraId` - Get stream URLs for a camera

#### Admin Endpoints (JWT Required)

- `POST /api/auth/login` - Admin login
- `POST /api/auth/logout` - Admin logout
- `GET /api/cameras` - List all cameras (including disabled)
- `POST /api/cameras` - Add new camera
- `PUT /api/cameras/:id` - Update camera
- `DELETE /api/cameras/:id` - Delete camera

## 🧪 Testing

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

## 📦 Production Deployment

### Build Frontend

```bash
cd frontend
npm run build
# Serve dist/ folder with nginx or serve via Fastify static
```

### Run Backend

```bash
cd backend
npm start
```

### MediaMTX

```bash
cd mediamtx
./mediamtx mediamtx.yml
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # MediaMTX WebRTC
    location /camera {
        proxy_pass http://localhost:8889;
    }
}
```

## 📄 License

MIT License

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a pull request.

## 📞 Support

For issues and questions, please open a GitHub issue.
