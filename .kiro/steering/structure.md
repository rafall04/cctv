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
│   ├── adminController.js  # Admin dashboard & statistics
│   ├── apiKeyController.js # API key management
│   ├── areaController.js   # Area/zone management
│   ├── authController.js   # Authentication (login/logout/refresh)
│   ├── cameraController.js # Camera CRUD operations
│   ├── csrfController.js   # CSRF token generation
│   ├── feedbackController.js # Feedback management
│   ├── settingsController.js # System settings
│   ├── streamController.js # Stream URL generation
│   ├── userController.js   # User management
│   └── viewerController.js # Viewer session tracking
├── data/                   # SQLite database files
│   └── cctv.db            # Main database file
├── database/               # Database setup and utilities
│   ├── database.js        # Database connection and query helpers
│   ├── setup.js           # Database initialization script
│   └── migrate_security.js # Security features migration
├── middleware/             # Custom middleware
│   ├── apiKeyValidator.js  # API key validation
│   ├── authMiddleware.js   # JWT authentication
│   ├── csrfProtection.js   # CSRF protection
│   ├── fingerprintValidator.js # Device fingerprinting
│   ├── inputSanitizer.js   # Input sanitization & XSS prevention
│   ├── originValidator.js  # Origin/Referer validation
│   ├── rateLimiter.js      # Rate limiting
│   ├── schemaValidators.js # Request schema validation
│   └── securityHeaders.js  # Security headers
├── routes/                 # API route definitions
│   ├── adminRoutes.js      # Admin endpoints
│   ├── areaRoutes.js       # Area management
│   ├── authRoutes.js       # Authentication
│   ├── cameraRoutes.js     # Camera management
│   ├── feedbackRoutes.js   # Feedback endpoints
│   ├── hlsProxyRoutes.js   # HLS proxy with session tracking
│   ├── settingsRoutes.js   # System settings
│   ├── streamRoutes.js     # Stream URLs
│   ├── userRoutes.js       # User management
│   └── viewerRoutes.js     # Viewer sessions
├── services/               # External service integrations
│   ├── apiKeyService.js    # API key generation & validation
│   ├── bruteForceProtection.js # Login attempt tracking
│   ├── cacheService.js     # In-memory caching
│   ├── cameraHealthService.js # Camera health monitoring
│   ├── mediaMtxService.js  # MediaMTX API communication
│   ├── passwordExpiry.js   # Password expiration tracking
│   ├── passwordHistory.js  # Password history management
│   ├── passwordValidator.js # Password policy enforcement
│   ├── securityAuditLogger.js # Security event logging
│   ├── sessionManager.js   # Session management
│   ├── streamWarmer.js     # Stream pre-warming
│   ├── telegramService.js  # Telegram bot notifications
│   └── viewerSessionService.js # Viewer session cleanup
├── .env                   # Environment variables (local)
├── .env.example           # Environment template
├── package.json           # Dependencies and scripts
├── server.js              # Application entry point
└── vitest.config.js       # Vitest test configuration
```

## Frontend Structure (`frontend/`)

```
frontend/
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── AdminLayout.jsx # Admin panel layout wrapper
│   │   ├── ApiClientInitializer.jsx # API client setup
│   │   ├── ProtectedRoute.jsx # Authentication guard
│   │   ├── VideoPlayer.jsx # HLS video player component
│   │   └── ui/            # UI components (Toast, Modal, etc)
│   ├── contexts/          # React contexts
│   │   ├── NotificationContext.jsx # Toast notifications
│   │   ├── SecurityContext.jsx # Security state (CSRF, API key)
│   │   └── ThemeContext.jsx # Theme management
│   ├── pages/              # Page-level components
│   │   ├── AreaManagement.jsx    # Area/zone management page
│   │   ├── CameraManagement.jsx  # Camera CRUD interface
│   │   ├── Dashboard.jsx         # Admin dashboard
│   │   ├── FeedbackManagement.jsx # Feedback management
│   │   ├── LandingPage.jsx       # Public camera viewing
│   │   ├── LoginPage.jsx         # Admin authentication
│   │   ├── Settings.jsx          # System settings
│   │   ├── UserManagement.jsx    # User management
│   │   └── ViewerAnalytics.jsx   # Viewer analytics
│   ├── services/           # API client modules
│   │   ├── adminService.js # Admin-specific API calls
│   │   ├── apiClient.js    # Base HTTP client configuration
│   │   ├── areaService.js  # Area management API
│   │   ├── authService.js  # Authentication API
│   │   ├── cameraService.js # Camera management API
│   │   ├── feedbackService.js # Feedback API
│   │   ├── settingsService.js # Settings API
│   │   ├── streamService.js # Stream URL fetching
│   │   ├── userService.js  # User management API
│   │   └── viewerService.js # Viewer session API
│   ├── utils/              # Utility modules
│   │   ├── animationControl.js # Animation optimization
│   │   ├── connectionTester.js # Network testing
│   │   ├── deviceDetector.js # Device capability detection
│   │   ├── errorRecovery.js # HLS error recovery
│   │   ├── fallbackHandler.js # Stream fallback
│   │   ├── hlsConfig.js    # Device-adaptive HLS config
│   │   ├── loadingTimeoutHandler.js # Loading timeout
│   │   ├── multiViewManager.js # Multi-stream management
│   │   ├── orientationObserver.js # Orientation handling
│   │   ├── performanceOptimizer.js # Performance utils
│   │   ├── preloadManager.js # Stream preloading
│   │   ├── rafThrottle.js  # RAF-based throttling
│   │   ├── streamInitQueue.js # Stream init queue
│   │   ├── streamLoaderTypes.js # Stream loader types
│   │   ├── validators.js   # Input validators
│   │   └── visibilityObserver.js # Visibility detection
│   ├── App.jsx             # Main application component
│   ├── main.jsx            # React application entry point
│   └── index.css           # Global styles and Tailwind imports
├── .env                    # Environment variables (local)
├── .env.example            # Environment template
├── index.html              # HTML template
├── package.json            # Dependencies and scripts
├── postcss.config.cjs      # PostCSS configuration
├── tailwind.config.js      # Tailwind CSS configuration
├── vite.config.js          # Vite build configuration
└── vitest.config.js        # Vitest test configuration
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
GET  /api/auth/csrf             # Get CSRF token
POST /api/auth/login            # Admin login
GET  /api/cameras/active        # List enabled cameras
GET  /api/stream                # Get all active streams
GET  /api/stream/:cameraId      # Get stream URLs for camera
POST /api/viewer/start          # Start viewer session
POST /api/viewer/heartbeat      # Update viewer session
POST /api/viewer/stop           # Stop viewer session
POST /api/feedback              # Submit feedback
GET  /hls/:cameraPath/*         # HLS proxy with session tracking
```

### Protected Routes (JWT Required)
```
POST /api/auth/logout           # Admin logout
POST /api/auth/refresh          # Refresh JWT token
GET  /api/auth/verify           # Verify JWT token
GET  /api/cameras               # List all cameras (admin)
GET  /api/cameras/:id           # Get single camera
POST /api/cameras               # Create camera
PUT  /api/cameras/:id           # Update camera
DELETE /api/cameras/:id         # Delete camera
GET  /api/areas                 # List all areas
POST /api/areas                 # Create area
PUT  /api/areas/:id             # Update area
DELETE /api/areas/:id           # Delete area
GET  /api/admin/dashboard       # Dashboard statistics
GET  /api/admin/api-keys        # List API keys
POST /api/admin/api-keys        # Create API key
DELETE /api/admin/api-keys/:id  # Delete API key
GET  /api/users                 # List users
POST /api/users                 # Create user
PUT  /api/users/:id             # Update user
DELETE /api/users/:id           # Delete user
GET  /api/feedback              # List all feedback (admin)
PUT  /api/feedback/:id          # Update feedback status
DELETE /api/feedback/:id        # Delete feedback
GET  /api/settings              # Get system settings
PUT  /api/settings              # Update system settings
GET  /api/viewer/sessions       # Get active viewer sessions
```

## Database Schema Organization

### Core Tables
- `users` - Admin user accounts with password history
- `cameras` - Camera configurations and RTSP URLs
- `areas` - Camera grouping/zones dengan detail lokasi (RT/RW/Kelurahan/Kecamatan)
- `audit_logs` - Admin action logging
- `feedbacks` - User feedback dan kritik/saran
- `api_keys` - API key management untuk external access
- `password_history` - Password history untuk prevent reuse
- `login_attempts` - Brute force protection tracking
- `viewer_sessions` - Active viewer session tracking

### Key Relationships
- `cameras.area_id` → `areas.id` (optional foreign key)
- `audit_logs.user_id` → `users.id` (required foreign key)
- `password_history.user_id` → `users.id` (required foreign key)
- `login_attempts.user_id` → `users.id` (optional foreign key)
- `api_keys.created_by` → `users.id` (required foreign key)

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