# Project Structure & Organization

## Root Directory Layout

```
cctv/
├── .agent/                 # Agent configuration and workflows
├── .git/                   # Git repository data
├── .kiro/                  # Kiro IDE configuration and steering rules
├── backend/                # Fastify API server
├── frontend/               # React SPA application
├── mediamtx/               # MediaMTX streaming server
├── deployment/             # Production deployment scripts and configs
├── *.sh                    # Various fix and utility scripts
├── PROJECT_*.md            # Project documentation
└── README.md               # Main project documentation
```

## Backend Structure (`backend/`)

```
backend/
├── config/
│   └── config.js           # Environment configuration and settings
├── controllers/            # Route handlers and business logic
│   ├── adminController.js  # Admin-specific operations
│   ├── areaController.js   # Area/zone management
│   ├── authController.js   # Authentication (login/logout)
│   ├── cameraController.js # Camera CRUD operations
│   └── streamController.js # Stream URL generation
├── data/                   # SQLite database files
│   └── cctv.db            # Main database file
├── database/               # Database setup and utilities
│   ├── database.js        # Database connection and query helpers
│   └── setup.js           # Database initialization script
├── middleware/             # Custom middleware
│   └── authMiddleware.js  # JWT authentication middleware
├── routes/                 # API route definitions
├── services/               # External service integrations
│   └── mediaMtxService.js # MediaMTX API communication
├── .env                   # Environment variables (local)
├── .env.example           # Environment template
├── package.json           # Dependencies and scripts
└── server.js              # Application entry point
```

## Frontend Structure (`frontend/`)

```
frontend/
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── AdminLayout.jsx # Admin panel layout wrapper
│   │   ├── ProtectedRoute.jsx # Authentication guard
│   │   └── VideoPlayer.jsx # HLS video player component
│   ├── pages/              # Page-level components
│   │   ├── AreaManagement.jsx    # Area/zone management page
│   │   ├── CameraManagement.jsx  # Camera CRUD interface
│   │   ├── Dashboard.jsx         # Admin dashboard
│   │   ├── LandingPage.jsx       # Public camera viewing
│   │   └── LoginPage.jsx         # Admin authentication
│   ├── services/           # API client modules
│   │   ├── adminService.js # Admin-specific API calls
│   │   ├── apiClient.js    # Base HTTP client configuration
│   │   ├── areaService.js  # Area management API
│   │   ├── authService.js  # Authentication API
│   │   ├── cameraService.js # Camera management API
│   │   └── streamService.js # Stream URL fetching
│   ├── App.jsx             # Main application component
│   ├── main.jsx            # React application entry point
│   └── index.css           # Global styles and Tailwind imports
├── .env                    # Environment variables (local)
├── .env.example            # Environment template
├── index.html              # HTML template
├── package.json            # Dependencies and scripts
├── tailwind.config.js      # Tailwind CSS configuration
└── vite.config.js          # Vite build configuration
```

## MediaMTX Structure (`mediamtx/`)

```
mediamtx/
├── mediamtx.exe           # MediaMTX binary (Windows)
├── mediamtx.yml           # MediaMTX configuration
├── mediamtx.yml.example   # Configuration template
└── LICENSE                # MediaMTX license
```

## Deployment Structure (`deployment/`)

```
deployment/
├── *.env.prod             # Production environment files
├── ecosystem.config.cjs   # PM2 process configuration
├── mediamtx.yml           # Production MediaMTX config
├── nginx.conf             # Nginx reverse proxy config
├── *.sh                   # Deployment and fix scripts
└── README.md              # Deployment documentation
```

## Naming Conventions

### Files & Directories
- **Backend**: camelCase for JS files (`cameraController.js`)
- **Frontend**: PascalCase for components (`VideoPlayer.jsx`)
- **Frontend**: camelCase for services (`cameraService.js`)
- **Config**: lowercase with extensions (`.env`, `config.js`)

### Code Conventions
- **Components**: PascalCase (`VideoPlayer`, `AdminLayout`)
- **Functions**: camelCase (`getAllCameras`, `createCamera`)
- **Constants**: UPPER_SNAKE_CASE (`JWT_SECRET`, `DATABASE_PATH`)
- **Database**: snake_case (`camera_id`, `created_at`)

## API Route Organization

### Public Routes (No Authentication)
```
GET  /health                    # Health check
GET  /api/cameras/active        # List enabled cameras
GET  /api/stream               # Get all active streams
GET  /api/stream/:cameraId     # Get stream URLs for camera
POST /api/auth/login           # Admin login
```

### Protected Routes (JWT Required)
```
POST /api/auth/logout          # Admin logout
GET  /api/auth/verify          # Verify JWT token
GET  /api/cameras              # List all cameras (admin)
GET  /api/cameras/:id          # Get single camera
POST /api/cameras              # Create camera
PUT  /api/cameras/:id          # Update camera
DELETE /api/cameras/:id        # Delete camera
```

## Database Schema Organization

### Core Tables
- `users` - Admin user accounts
- `cameras` - Camera configurations and RTSP URLs
- `areas` - Camera grouping/zones (optional)
- `audit_logs` - Admin action logging

### Key Relationships
- `cameras.area_id` → `areas.id` (optional foreign key)
- `audit_logs.user_id` → `users.id` (required foreign key)

## Configuration Files

### Environment Files
- `backend/.env` - Backend configuration
- `frontend/.env` - Frontend configuration
- `deployment/*.env.prod` - Production overrides

### Build Configuration
- `frontend/vite.config.js` - Vite build settings
- `frontend/tailwind.config.js` - CSS framework config
- `mediamtx/mediamtx.yml` - Streaming server config

## Security Considerations

### File Access Patterns
- **Public**: Frontend `src/` directory (no sensitive data)
- **Private**: Backend `config/`, `.env` files (server-side only)
- **Sensitive**: Database files, RTSP URLs (never exposed to frontend)

### API Security Layers
1. **CORS**: Configured origins in `config.js`
2. **JWT**: Protected routes require valid tokens
3. **Input Validation**: All request bodies validated in controllers
4. **Audit Logging**: Admin actions logged with IP addresses