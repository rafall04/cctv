# Technology Stack & Build System

## Core Technologies

### Backend
- **Runtime**: Node.js 20+ with ES modules (`"type": "module"`)
- **Framework**: Fastify 4.x (high-performance web framework)
- **Database**: SQLite with better-sqlite3 (embedded database)
- **Authentication**: JWT with @fastify/jwt, bcrypt for password hashing
- **HTTP Client**: Axios for MediaMTX API communication

### Frontend
- **Framework**: React 18.x with functional components and hooks
- **Build Tool**: Vite 5.x (fast development and build)
- **Routing**: React Router DOM 6.x
- **Styling**: Tailwind CSS 3.x with custom design system
- **Video Streaming**: HLS.js for video playback

### External Services
- **MediaMTX**: RTSP to WebRTC/HLS transcoding server
  - HLS endpoint: `http://localhost:8888`
  - WebRTC endpoint: `http://localhost:8889`
  - API endpoint: `http://localhost:9997`

## Development Commands

### Backend (Node.js/Fastify)
```bash
cd backend
npm install                 # Install dependencies
npm run dev                 # Start development server with nodemon
npm run start              # Start production server
npm run setup-db           # Initialize SQLite database with sample data
```

### Frontend (React/Vite)
```bash
cd frontend
npm install                 # Install dependencies
npm run dev                 # Start development server (port 5173)
npm run build              # Build for production
npm run preview            # Preview production build
npm run lint               # Run ESLint
```

### MediaMTX
```bash
cd mediamtx
./mediamtx.exe mediamtx.yml    # Windows
./mediamtx mediamtx.yml        # Linux/macOS
```

## Development Ports

| Service | Port | Purpose |
|---------|------|---------|
| Backend API | 3000 | Fastify REST API |
| Frontend Dev | 5173 | Vite development server |
| MediaMTX HLS | 8888 | HLS streaming endpoint |
| MediaMTX WebRTC | 8889 | WebRTC streaming endpoint |
| MediaMTX API | 9997 | MediaMTX management API |

## Build Configuration

### Vite Configuration
- **Dev Server**: Proxy `/api` requests to backend (port 3000)
- **Build Output**: `dist/` directory
- **Code Splitting**: React vendor bundle, HLS.js vendor bundle
- **Source Maps**: Disabled in production

### Tailwind Configuration
- **Content**: Scans `./src/**/*.{js,jsx,ts,tsx}` and `./index.html`
- **Dark Mode**: Class-based (`darkMode: 'class'`)
- **Custom Colors**: RAF NET brand palette (primary, accent, dark)
- **Custom Animations**: fade-in, slide-up, pulse-slow

## Environment Variables

### Backend (.env)
```env
PORT=3000
HOST=0.0.0.0
JWT_SECRET=your-secret-key-change-this
JWT_EXPIRATION=24h
MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_HLS_URL=http://localhost:8888
MEDIAMTX_WEBRTC_URL=http://localhost:8889
DATABASE_PATH=./data/cctv.db
CORS_ORIGIN=http://localhost:5173,http://localhost:3000
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3000
```

## Testing & Quality

### Backend
- **Linting**: ESLint with Node.js rules
- **Logging**: Pino with pretty printing in development
- **Error Handling**: Global error handler with structured responses

### Frontend
- **Linting**: ESLint with React hooks and refresh plugins
- **Type Safety**: PropTypes or TypeScript (optional)
- **Code Quality**: Vite's built-in optimizations

## Production Build Process

1. **Frontend**: `npm run build` → generates `dist/` folder
2. **Backend**: `npm run start` → production server
3. **Database**: Ensure SQLite file exists and is initialized
4. **MediaMTX**: Configure with production camera URLs
5. **Reverse Proxy**: Nginx to serve frontend and proxy API calls