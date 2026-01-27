# Technology Stack & Build System

## Core Technologies

### Backend
- **Runtime**: Node.js 20+ with ES modules (`"type": "module"`)
- **Framework**: Fastify 4.28.1 (high-performance web framework)
- **Database**: SQLite with better-sqlite3 11.7.0 (embedded database)
- **Authentication**: JWT with @fastify/jwt 8.0.1, bcrypt 5.1.1 for password hashing
- **HTTP Client**: Axios 1.13.2 for MediaMTX API communication
- **Security**: 
  - @fastify/helmet 13.0.2 (security headers)
  - @fastify/rate-limit 10.3.0 (rate limiting)
  - @fastify/cookie 9.4.0 (cookie management)
  - @fastify/cors 9.0.1 (CORS handling)
- **Utilities**: 
  - uuid 9.0.1 (UUID generation untuk stream keys)
  - nanoid 5.0.8 (ID generation)
  - dotenv 16.4.5 (environment variables)

### Frontend
- **Framework**: React 18.3.1 with functional components and hooks
- **Build Tool**: Vite 5.3.1 (fast development and build)
- **Routing**: React Router DOM 6.26.0
- **Styling**: Tailwind CSS 3.4.4 with custom design system
- **Video Streaming**: HLS.js 1.5.15 for video playback
- **Maps**: Leaflet 1.9.4 + React Leaflet 4.2.1 (camera location mapping)
- **HTTP Client**: Axios 1.7.7

### External Services
- **MediaMTX**: RTSP to WebRTC/HLS transcoding server
  - HLS endpoint: `http://localhost:8888`
  - WebRTC endpoint: `http://localhost:8889`
  - API endpoint: `http://localhost:9997`
- **Telegram Bot**: Notifikasi monitoring kamera dan feedback (optional)

## Stream Architecture

### Camera Path Management
Sistem menggunakan `camera{id}` sebagai path MediaMTX untuk setiap kamera.

**Database Schema:**
```sql
CREATE TABLE cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    private_rtsp_url TEXT NOT NULL,
    description TEXT,
    location TEXT,
    group_name TEXT,
    area_id INTEGER,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL
)
```

**Flow:**
1. Camera dibuat dengan ID auto-increment
2. MediaMTX path menggunakan `camera{id}` sebagai nama path
3. Frontend request stream via `/hls/camera{id}/index.m3u8`
4. HLS proxy route backend untuk session tracking

**Files terkait:**
- `backend/controllers/cameraController.js` - CRUD operations
- `backend/services/mediaMtxService.js` - Sync dengan MediaMTX
- `backend/controllers/streamController.js` - Return stream URLs
- `backend/routes/hlsProxyRoutes.js` - Proxy HLS dengan session tracking

### Stream Preload/Warming Service
Sistem menggunakan preload stream untuk mempercepat initial load video.

**Cara Kerja:**
1. Backend startup → `streamWarmer.js` mulai warming enabled cameras
2. Service melakukan HTTP request ke HLS endpoint untuk trigger MediaMTX pull RTSP
3. Stream sudah ready saat user pertama kali akses (tidak perlu tunggu RTSP connect)

**Konfigurasi:**
```javascript
// backend/services/streamWarmer.js
const WARM_INTERVAL = 60000;      // Re-warm setiap 60 detik
const WARM_DELAY_BETWEEN = 500;   // Delay 500ms antar kamera
```

**Files terkait:**
- `backend/services/streamWarmer.js` - Service utama preload
- `backend/server.js` - Start warming saat server ready

**Catatan Penting:**
- Warming service menggunakan `stream_key` bukan `camera{id}`
- Health check menggunakan `/config/paths/list` (configured paths) bukan `/paths/list` (active streams)
- Alasan: `sourceOnDemand: true` berarti stream hanya aktif saat ada viewer

### Camera Health Check
Health check untuk status kamera di dashboard admin.

**Endpoint yang digunakan:**
- `/config/paths/list` - List semua path yang dikonfigurasi (termasuk yang belum aktif)
- BUKAN `/paths/list` - Hanya menampilkan stream yang sedang aktif

**Alasan:**
Karena MediaMTX menggunakan `sourceOnDemand: true`, stream hanya aktif saat ada viewer. Jika menggunakan `/paths/list`, kamera akan selalu terlihat offline saat tidak ada viewer.

**Files terkait:**
- `backend/services/cameraHealthService.js` - Health check logic
- `backend/controllers/adminController.js` - Dashboard stats dengan camera lookup

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


## Video Player Utility Modules

The video player optimization system consists of several utility modules that work together to provide device-adaptive, performant video streaming.

### Device Detection (`frontend/src/utils/deviceDetector.js`)
Detects device capabilities for adaptive configuration.

```javascript
// Usage
import { detectDeviceTier, getDeviceCapabilities, getMaxConcurrentStreams } from '../utils/deviceDetector';

const tier = detectDeviceTier(); // 'low' | 'medium' | 'high'
const caps = getDeviceCapabilities(); // Full capability object
const maxStreams = getMaxConcurrentStreams(tier); // 2 for low, 3 for medium/high
```

**Device Tiers:**
- **Low**: RAM ≤ 2GB OR CPU cores ≤ 2 OR mobile with RAM ≤ 3GB
- **Medium**: Default tier for most devices
- **High**: RAM > 4GB AND CPU cores > 4

### HLS Configuration (`frontend/src/utils/hlsConfig.js`)
Provides device-adaptive HLS.js configurations.

```javascript
// Usage
import { getHLSConfig, getMobileHLSConfig } from '../utils/hlsConfig';

const config = getHLSConfig('low'); // Returns low-end optimized config
const mobileConfig = getMobileHLSConfig('medium'); // Mobile-specific config
```

**Configuration Differences by Tier:**
| Setting | Low | Medium | High |
|---------|-----|--------|------|
| enableWorker | false | true | true |
| maxBufferLength | 15s | 25s | 30s |
| backBufferLength | 10s | 20s | 30s |
| maxBufferSize | 30MB | 45MB | 60MB |
| startLevel | 0 (lowest) | -1 (auto) | -1 (auto) |

### Error Recovery (`frontend/src/utils/errorRecovery.js`)
Handles HLS errors with exponential backoff.

```javascript
// Usage
import { createErrorRecovery, getBackoffDelay } from '../utils/errorRecovery';

const delay = getBackoffDelay(retryCount); // 1s, 2s, 4s, 8s max

const recovery = createErrorRecovery(hls, {
    maxRetries: 3,
    onRecoveryAttempt: (attempt) => console.log(`Retry ${attempt}`),
    onRecoveryFailed: () => setStatus('error')
});

recovery.handleError(errorData);
recovery.reset();
```

### Visibility Observer (`frontend/src/utils/visibilityObserver.js`)
Intersection Observer wrapper for lazy loading and visibility-based stream control.

```javascript
// Usage
import { createVisibilityObserver } from '../utils/visibilityObserver';

const observer = createVisibilityObserver({ threshold: 0.1 });
observer.observe(element, (isVisible) => {
    if (isVisible) playVideo();
    else pauseVideo();
});
observer.unobserve(element);
observer.disconnect();
```

### Multi-View Manager (`frontend/src/utils/multiViewManager.js`)
Manages multiple video streams with optimized performance.

```javascript
// Usage
import { createMultiViewManager, staggeredInitialize } from '../utils/multiViewManager';

// Create manager instance
const manager = createMultiViewManager({
    maxStreams: 3,      // Override device-based limit
    staggerDelay: 100   // 100ms between stream inits
});

// Add streams (respects device limits)
manager.addStream(camera1);
manager.addStream(camera2);

// Initialize all with staggered timing
await manager.initializeAll(initStreamFn);

// Check capacity
console.log(manager.getMaxStreams());    // 2 for low, 3 for medium/high
console.log(manager.isAtCapacity());     // true/false
console.log(manager.getStreamCount());   // Current stream count

// Cleanup all streams
manager.cleanup();
```

**Stream Limits by Device Tier:**
| Tier | Max Concurrent Streams |
|------|----------------------|
| Low | 2 |
| Medium | 3 |
| High | 3 |

### RAF Throttle (`frontend/src/utils/rafThrottle.js`)
RequestAnimationFrame-based throttling for high-frequency events (zoom/pan).

```javascript
// Usage - Generic throttle
import { createRAFThrottle, createTransformThrottle } from '../utils/rafThrottle';

// Option 1: Generic RAF throttle for any callback
const { throttled, cancel } = createRAFThrottle((x, y) => {
    element.style.transform = `translate(${x}px, ${y}px)`;
});
element.addEventListener('mousemove', (e) => throttled(e.clientX, e.clientY));
// On cleanup: cancel();

// Option 2: Specialized transform throttle
const transformer = createTransformThrottle(wrapperElement);
transformer.update(scale, panX, panY); // scale=2, panX=10%, panY=-5%
// On cleanup: transformer.cancel();

// Measure update rate (for testing)
import { createUpdateRateMeter } from '../utils/rafThrottle';
const meter = createUpdateRateMeter();
meter.record(); // Call on each update
console.log(meter.getRate()); // Updates per second (should be ≤60)
```

**Throttle Configuration:**
- Minimum interval: 16.67ms (~60fps)
- Uses `requestAnimationFrame` for smooth updates
- Automatically coalesces rapid updates

### Orientation Observer (`frontend/src/utils/orientationObserver.js`)
Handles device orientation changes without triggering stream reloads.

```javascript
// Usage
import { createOrientationObserver, getCurrentOrientation } from '../utils/orientationObserver';

// Get current orientation
const orientation = getCurrentOrientation(); // 'portrait' | 'landscape'

// Create observer
const observer = createOrientationObserver({
    onOrientationChange: ({ orientation, previousOrientation, isPortrait, isLandscape }) => {
        // Adapt layout without reloading stream
        updateLayout(isPortrait ? 'portrait' : 'landscape');
    },
    debounceResize: true,
    debounceDelay: 100
});

observer.start();
console.log(observer.getOrientation()); // Current orientation
console.log(observer.isActive());       // true/false
observer.stop();
```

### Additional Utilities

**Animation Control (`frontend/src/utils/animationControl.js`)**
- Controls CSS animations based on device performance
- Disables animations on low-end devices

**Connection Tester (`frontend/src/utils/connectionTester.js`)**
- Tests network connectivity before loading streams
- Provides connection quality metrics

**Fallback Handler (`frontend/src/utils/fallbackHandler.js`)**
- Handles stream fallback scenarios (WebRTC → HLS)
- Automatic quality degradation

**Loading Timeout Handler (`frontend/src/utils/loadingTimeoutHandler.js`)**
- Manages loading timeouts for streams
- Prevents infinite loading states

**Performance Optimizer (`frontend/src/utils/performanceOptimizer.js`)**
- Global performance optimization utilities
- Memory management helpers

**Preload Manager (`frontend/src/utils/preloadManager.js`)**
- Manages stream preloading
- Prioritizes visible streams

**Stream Init Queue (`frontend/src/utils/streamInitQueue.js`)**
- Queues stream initialization
- Prevents concurrent initialization overload

**Validators (`frontend/src/utils/validators.js`)**
- Input validation utilities
- URL and data validation

## Testing Libraries

### Property-Based Testing
- **Library**: fast-check
- **Backend Version**: 4.5.2
- **Frontend Version**: 3.23.0
- **Test Runner**: Vitest 4.0.16 (backend), Vitest 2.1.0 (frontend)
- **Config**: Minimum 100 iterations per property test

```bash
# Install (already included in devDependencies)
cd backend && npm install
cd frontend && npm install

# Run tests
npm test          # Run once
npm run test:watch # Watch mode
```

### Test File Naming
- Unit tests: `*.test.js`
- Property tests: `*.property.test.js`
- Integration tests: `*.integration.test.js`

### Property Test Files (if created)
| Test File | Module Tested | Properties Validated |
|-----------|---------------|---------------------|
| `deviceDetector.property.test.js` | deviceDetector | Device tier consistency |
| `hlsConfig.property.test.js` | hlsConfig | Config correctness by tier |
| `errorRecovery.property.test.js` | errorRecovery | Exponential backoff |
| `resourceCleanup.property.test.js` | VideoPlayer | Resource cleanup |
| `rafThrottle.property.test.js` | rafThrottle | Event throttling (≤60fps) |
| `multiViewManager.property.test.js` | multiViewManager | Stream limits, cleanup |

**Note**: Test files should be deleted after spec completion (see cleanup.md)
