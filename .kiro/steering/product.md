# RAF NET Secure CCTV Hub

## Product Overview

RAF NET CCTV Hub adalah sistem video streaming yang aman dan berkinerja tinggi yang mengisolasi kamera IP privat dari eksposur publik sambil menyediakan akses web publik ke stream kamera. Sistem ini bertindak sebagai gateway aman antara kamera RTSP privat dan penonton publik.

## Key Features

### Public Features
- **Public Camera Viewing**: Siapa saja dapat melihat stream CCTV yang diaktifkan tanpa autentikasi
- **Interactive Map**: Peta interaktif dengan Leaflet untuk melihat lokasi kamera
- **Feedback System**: Sistem kritik dan saran untuk user publik
- **Viewer Analytics**: Tracking jumlah viewer aktif per kamera
- **Responsive Design**: Dark mode, glassmorphism effects, responsive untuk semua device

### Admin Features
- **Secure Admin Panel**: Autentikasi JWT-based untuk manajemen kamera
- **Camera Management**: CRUD operations untuk kamera (add/edit/delete, configure RTSP URLs)
- **Area Management**: Grouping kamera berdasarkan area/zona dengan detail lokasi (RT/RW/Kelurahan/Kecamatan)
- **User Management**: Multi-user support dengan role-based access
- **Feedback Management**: Review dan manage feedback dari user
- **Dashboard Analytics**: Real-time statistics (total cameras, active viewers, feedback count)
- **API Key Management**: Generate dan manage API keys untuk external access
- **System Settings**: Configure Telegram notifications dan system parameters
- **Audit Logging**: Comprehensive logging untuk semua admin actions

### Security Features
- **Private IP Protection**: Camera RTSP URLs tidak pernah exposed ke client browsers
- **Multi-Layer Security**:
  - Security Headers (CSP, X-Frame-Options, etc)
  - Rate Limiting (100 req/min public, 30 req/min auth)
  - API Key Validation
  - Origin/Referer Validation
  - CSRF Protection
  - Input Sanitization & XSS Prevention
  - Brute Force Protection (max 5 attempts, 30 min lockout)
  - Device Fingerprinting
- **Password Policy**: Min 12 characters, 90-day expiration, history tracking
- **Session Management**: Absolute timeout 24 hours
- **Security Audit Logging**: 90-day retention dengan daily cleanup

### Streaming Features
- **Low Latency Streaming**: HLS streaming via MediaMTX
- **Auto-Reconnect**: Intelligent stream reconnection on network interruptions
- **Stream Pre-warming**: Pre-warm camera streams untuk faster initial load
- **Camera Health Monitoring**: Real-time health check setiap 30 detik
- **Viewer Session Tracking**: Track active viewers per camera dengan heartbeat mechanism
- **HLS Proxy**: Backend proxy untuk session tracking dan security

### Integration Features
- **Telegram Bot Integration**: 
  - Camera monitoring alerts (offline/online)
  - Feedback notifications
  - Configurable via admin settings
- **MediaMTX Integration**: Automatic sync dengan MediaMTX untuk path management

## Architecture

```
End User → [Public Landing Page] → Backend HLS Proxy → MediaMTX (HLS) → Private RTSP Cameras
                                         ↓
                                  Viewer Session Tracking
                                         ↓
                                  Telegram Notifications

Admin → [Login] → [Admin Panel] → Fastify API → SQLite → MediaMTX Management
                                                    ↓
                                            Security Middleware Chain
```

## Security Model

- **Camera Isolation**: RTSP URLs stored server-side only, never exposed to frontend
- **Admin Authentication**: JWT-based dengan bcrypt password hashing, device fingerprinting
- **Public Access**: Streams publicly accessible tapi cameras bisa disabled
- **Audit Logging**: All admin actions logged dengan IP addresses dan timestamps
- **Multi-Layer Protection**: 7-layer security middleware chain
- **Brute Force Protection**: Account lockout setelah 5 failed attempts
- **CSRF Protection**: Token-based CSRF protection untuk state-changing requests
- **Input Sanitization**: XSS prevention dengan HTML entity encoding

## Default Credentials

- Username: `admin`
- Password: `admin123`
- **CRITICAL**: Change immediately in production

## Target Users

- **Public Users**: View camera streams on landing page, submit feedback
- **Administrators**: Manage cameras, areas, users, review feedback, monitor system
- **External Systems**: Access via API keys untuk integration