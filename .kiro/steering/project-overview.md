# Project Overview

## RAF NET Secure CCTV Hub

Sistem video streaming yang aman untuk mengisolasi kamera IP privat dari eksposur publik sambil menyediakan akses web publik ke stream kamera.

### Key Features

**Public:**
- Public camera viewing tanpa autentikasi
- Interactive map dengan Leaflet
- Feedback system
- Viewer analytics
- Dark mode, responsive design

**Admin:**
- JWT-based authentication
- Camera CRUD (RTSP URLs server-side only)
- Area management (RT/RW/Kelurahan/Kecamatan)
- User management
- Dashboard analytics
- API key management
- Audit logging

**Security:**
- Multi-layer: Security headers, rate limiting, CSRF, input sanitization, brute force protection
- Password policy: Min 12 chars, 90-day expiration
- Session timeout: 24 hours

**Streaming:**
- HLS via MediaMTX
- Auto-reconnect
- Stream pre-warming
- Health monitoring (30s interval)
- Viewer session tracking

### Architecture

```
User → Landing Page → Backend HLS Proxy → MediaMTX → Private RTSP Cameras
Admin → Login → Admin Panel → Fastify API → SQLite → MediaMTX Management
```

### Default Credentials
- Username: `admin`
- Password: `admin123`
- **CRITICAL:** Change in production

## Project Structure

### Root Directory
```
cctv/
├── backend/          # Fastify API server
├── frontend/         # React SPA
├── mediamtx/         # Streaming server
├── deployment/       # Production configs
└── *.md             # Documentation
```

### Backend Structure
```
backend/
├── controllers/      # Route handlers (camera, auth, admin, etc)
├── services/         # External integrations (MediaMTX, Telegram, recording)
├── middleware/       # Security (auth, CSRF, rate limit, validation)
├── routes/           # API route definitions
├── database/         # SQLite setup & migrations
├── data/            # cctv.db file
└── server.js        # Entry point
```

### Frontend Structure
```
frontend/
├── src/
│   ├── components/   # Reusable UI (VideoPlayer, ProtectedRoute)
│   ├── pages/        # Page components (LandingPage, Dashboard, etc)
│   ├── services/     # API clients (camera, auth, stream)
│   ├── utils/        # Video player utilities (device detection, HLS config)
│   └── contexts/     # React contexts (Theme, Security, Notification)
└── dist/            # Build output
```

### API Routes

**Public (No Auth):**
```
GET  /health
GET  /api/cameras/active
GET  /api/stream/:cameraId
POST /api/feedback
GET  /hls/:cameraPath/*
```

**Protected (JWT Required):**
```
POST /api/auth/logout
GET  /api/cameras
POST /api/cameras
PUT  /api/cameras/:id
DELETE /api/cameras/:id
GET  /api/admin/dashboard
GET  /api/users
```

### Database Schema

**Core Tables:**
- `users` - Admin accounts with password history
- `cameras` - Camera configs & RTSP URLs
- `areas` - Camera grouping (RT/RW/Kelurahan/Kecamatan)
- `audit_logs` - Admin action logging
- `feedbacks` - User feedback
- `api_keys` - External access
- `viewer_sessions` - Active viewer tracking

**Key Relationships:**
- `cameras.area_id` → `areas.id`
- `audit_logs.user_id` → `users.id`
- `api_keys.created_by` → `users.id`
