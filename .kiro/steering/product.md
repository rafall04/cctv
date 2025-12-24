# RAF NET Secure CCTV Hub

## Product Overview

RAF NET CCTV Hub is a secure, high-performance video streaming system that isolates private IP cameras from public exposure while providing public web access to camera streams. The system acts as a secure gateway between private RTSP cameras and public viewers.

## Key Features

- **Public Camera Viewing**: Anyone can view enabled CCTV streams without authentication
- **Admin Panel**: Secure JWT-based authentication for camera management
- **Private IP Protection**: Camera RTSP URLs never exposed to client browsers
- **Low Latency Streaming**: WebRTC for real-time viewing with HLS fallback
- **Modern UI**: Dark mode, glassmorphism effects, responsive design
- **Auto-Reconnect**: Intelligent stream reconnection on network interruptions

## Architecture

```
End User → [Public Landing Page] → MediaMTX (WebRTC/HLS) → Private RTSP Cameras
Admin → [Login] → [Admin Panel] → Fastify API → SQLite → MediaMTX Management
```

## Security Model

- **Camera Isolation**: RTSP URLs stored server-side only, never exposed to frontend
- **Admin Authentication**: JWT-based with bcrypt password hashing
- **Public Access**: Streams are publicly accessible but cameras can be disabled
- **Audit Logging**: All admin actions are logged with IP addresses

## Default Credentials

- Username: `admin`
- Password: `admin123`
- **CRITICAL**: Change immediately in production

## Target Users

- **Public Users**: View camera streams on landing page
- **Administrators**: Manage cameras, configure RTSP URLs, enable/disable streams