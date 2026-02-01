# Technology Stack

## Core Technologies

### Backend
- **Runtime:** Node.js 20+ (ES modules)
- **Framework:** Fastify 4.28.1
- **Database:** SQLite with better-sqlite3 11.7.0
- **Auth:** JWT (@fastify/jwt 8.0.1), bcrypt 5.1.1
- **Security:** @fastify/helmet, @fastify/rate-limit, @fastify/cors

### Frontend
- **Framework:** React 18.3.1
- **Build:** Vite 5.3.1
- **Routing:** React Router DOM 6.26.0
- **Styling:** Tailwind CSS 3.4.4
- **Video:** HLS.js 1.5.15
- **Maps:** Leaflet 1.9.4 + React Leaflet 4.2.1

### MediaMTX
- **HLS:** http://localhost:8888
- **WebRTC:** http://localhost:8889
- **API:** http://localhost:9997

## Development Commands

### Backend
```bash
cd backend
npm install
npm run dev          # Development with nodemon
npm run start        # Production
npm run setup-db     # Initialize database
```

### Frontend
```bash
cd frontend
npm install
npm run dev          # Dev server (port 5173)
npm run build        # Production build
```

### MediaMTX
```bash
cd mediamtx
./mediamtx.exe mediamtx.yml    # Windows
./mediamtx mediamtx.yml        # Linux
```

## Port Reference

| Service | Port | Purpose |
|---------|------|---------|
| Backend API | 3000 | Fastify REST API |
| Frontend Dev | 5173 | Vite dev server |
| MediaMTX HLS | 8888 | HLS streaming |
| MediaMTX WebRTC | 8889 | WebRTC streaming |
| MediaMTX API | 9997 | Management API |

## Stream Architecture

### Camera Path Management
Sistem menggunakan `camera{id}` sebagai path MediaMTX.

**Flow:**
1. Camera dibuat dengan ID auto-increment
2. MediaMTX path: `camera{id}`
3. Frontend request: `/hls/camera{id}/index.m3u8`
4. Backend HLS proxy untuk session tracking

**Files:**
- `backend/controllers/cameraController.js` - CRUD
- `backend/services/mediaMtxService.js` - Sync dengan MediaMTX
- `backend/routes/hlsProxyRoutes.js` - HLS proxy

### Stream Preload Service
Backend startup → `streamWarmer.js` warm enabled cameras → Stream ready saat user akses.

**Config:**
```javascript
const WARM_INTERVAL = 60000;      // Re-warm setiap 60 detik
const WARM_DELAY_BETWEEN = 500;   // Delay 500ms antar kamera
```

### Camera Health Check
Gunakan `/config/paths/list` (configured paths) bukan `/paths/list` (active streams).

**Alasan:** `sourceOnDemand: true` berarti stream hanya aktif saat ada viewer.

## MediaMTX Configuration

### CRITICAL: Safe Configuration

```yaml
# ✅ GUNAKAN INI
logLevel: info
api: yes
apiAddress: :9997
hls: yes
hlsAddress: :8888
hlsAlwaysRemux: yes
hlsAllowOrigin: '*'
webrtc: yes
webrtcAddress: :8889
webrtcAllowOrigin: '*'

# ❌ JANGAN GUNAKAN (causes 404)
hlsVariant: lowLatency
hlsPartDuration: 200ms
hlsSegmentDuration: 1s
hlsSegmentCount: 3
```

**Mengapa Low-Latency HLS Gagal:**
- Codec incompatibility (butuh fMP4 with CMAF)
- Camera limitations (H.264/MPEG-TS tidak support LL-HLS)
- Version mismatch (bug di MediaMTX lama)

### Troubleshooting

**HLS Returns 404:**
```bash
# Check MediaMTX running
curl http://localhost:9997/v3/config/global/get

# Check path exists
curl http://localhost:9997/v3/paths/list

# Trigger stream manually
curl http://localhost:8888/camera1/index.m3u8
```

**After Config Changes:**
```bash
pm2 restart mediamtx
# or
systemctl restart cctv-mediamtx
```

## Video Player Utilities

### Device Detection (`frontend/src/utils/deviceDetector.js`)
```javascript
import { detectDeviceTier, getMaxConcurrentStreams } from '../utils/deviceDetector';

const tier = detectDeviceTier(); // 'low' | 'medium' | 'high'
const maxStreams = getMaxConcurrentStreams(tier); // 2 for low, 3 for medium/high
```

**Device Tiers:**
- **Low:** RAM ≤ 2GB OR CPU ≤ 2 cores OR mobile RAM ≤ 3GB
- **Medium:** Default
- **High:** RAM > 4GB AND CPU > 4 cores

### HLS Configuration (`frontend/src/utils/hlsConfig.js`)
```javascript
import { getHLSConfig } from '../utils/hlsConfig';

const config = getHLSConfig('low'); // Device-adaptive config
```

**Config by Tier:**
| Setting | Low | Medium | High |
|---------|-----|--------|------|
| enableWorker | false | true | true |
| maxBufferLength | 15s | 25s | 30s |
| maxBufferSize | 30MB | 45MB | 60MB |
| startLevel | 0 (lowest) | -1 (auto) | -1 (auto) |

### Error Recovery (`frontend/src/utils/errorRecovery.js`)
```javascript
import { createErrorRecovery } from '../utils/errorRecovery';

const recovery = createErrorRecovery(hls, {
    maxRetries: 3,
    onRecoveryFailed: () => setStatus('error')
});

recovery.handleError(errorData);
```

**Exponential backoff:** 1s, 2s, 4s, 8s max

### Multi-View Manager (`frontend/src/utils/multiViewManager.js`)
```javascript
import { createMultiViewManager } from '../utils/multiViewManager';

const manager = createMultiViewManager();
manager.addStream(camera1);
await manager.initializeAll(initStreamFn);

console.log(manager.getMaxStreams()); // 2 for low, 3 for medium/high
```

### RAF Throttle (`frontend/src/utils/rafThrottle.js`)
```javascript
import { createRAFThrottle } from '../utils/rafThrottle';

const { throttled, cancel } = createRAFThrottle((x, y) => {
    element.style.transform = `translate(${x}px, ${y}px)`;
});

element.addEventListener('mousemove', (e) => throttled(e.clientX, e.clientY));
```

**Throttle:** Max 60fps dengan `requestAnimationFrame`

### Visibility Observer (`frontend/src/utils/visibilityObserver.js`)
```javascript
import { createVisibilityObserver } from '../utils/visibilityObserver';

const observer = createVisibilityObserver({ threshold: 0.1 });
observer.observe(element, (isVisible) => {
    if (isVisible) playVideo();
    else pauseVideo();
});
```

### Orientation Observer (`frontend/src/utils/orientationObserver.js`)
```javascript
import { createOrientationObserver } from '../utils/orientationObserver';

const observer = createOrientationObserver({
    onOrientationChange: ({ isPortrait }) => {
        updateLayout(isPortrait ? 'portrait' : 'landscape');
    }
});

observer.start();
```
