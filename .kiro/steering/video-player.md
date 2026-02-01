# Video Player Standards

## Video Player Layout Standards

### 1. MapView - Info di Atas Video

```
┌─────────────────────────────────────┐
│ Header Info (non-fullscreen)        │
│ - Camera name + CodecBadge          │
│ - Status badge (Stabil/Tunnel)      │
│ - Location + Area                   │
├─────────────────────────────────────┤
│         Video Player Area           │
├─────────────────────────────────────┤
│ Controls Panel (non-fullscreen)     │
│ - Zoom controls                     │
│ - Screenshot + Fullscreen buttons   │
└─────────────────────────────────────┘
```

### 2. GridView (LandingPage) - Info di Bawah Video

```
┌─────────────────────────────────────┐
│         Video Player Area           │
├─────────────────────────────────────┤
│ Footer Info (non-fullscreen)        │
│ - Camera name + CodecBadge          │
│ - Location + Area                   │
│ - Status badge                      │
│ - Controls (zoom, screenshot, etc)  │
└─────────────────────────────────────┘
```

### 3. Playback - Recording Player

```
┌─────────────────────────────────────┐
│ Header Info                         │
│ - Camera selector dropdown          │
│ - Date picker                       │
│ - Segment list                      │
├─────────────────────────────────────┤
│         Video Player Area           │
│         (dengan timeline controls)  │
├─────────────────────────────────────┤
│ Timeline Controls                   │
│ - Play/Pause                        │
│ - Timeline slider                   │
│ - Speed control (0.5x - 2x)         │
│ - Current time / Duration           │
│ - Download button                   │
└─────────────────────────────────────┘
```

**Perbedaan Playback vs Live Stream:**
- Playback: Ada timeline, speed control, seek, download
- Live Stream: Hanya play/pause, snapshot, fullscreen

### 4. Mode Fullscreen (Semua View)

```
┌─────────────────────────────────────┐
│ Top Bar (floating, gradient fade)   │
│ - Camera name + CodecBadge          │
│ - Status badge (LIVE/LOADING)       │
│ - Controls (snapshot, exit)         │
│                                     │
│         Video Player Area           │
│         (full screen)               │
│                                     │
│ Bottom Right (floating)             │
│ - Zoom controls                     │
└─────────────────────────────────────┘
```

## Codec Info Display Rules

### Rule 1: Codec Badge Only
- **Tampilkan:** CodecBadge component saja
- **Jangan:** Teks panjang "Codec: H264" atau warning box
- **Alasan:** Lebih clean, user bisa hover/tap badge untuk info

### Rule 2: Codec Badge Placement
- **Mode Normal:** Di samping nama kamera
  - MapView: Di header (atas video)
  - GridView: Di footer (bawah video)
- **Mode Fullscreen:** Di top bar, di samping nama kamera

### Rule 3: Implementation

```jsx
// MapView - Header (atas video)
{!isFullscreen && (
    <div className="p-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
            <h3>{camera.name}</h3>
            {camera.video_codec && (
                <CodecBadge codec={camera.video_codec} size="sm" showWarning={false} />
            )}
        </div>
    </div>
)}

// GridView - Footer (bawah video)
{!isFullscreen && (
    <div className="p-3 border-t border-gray-800">
        <div className="flex items-center gap-2">
            <h3>{camera.name}</h3>
            {camera.video_codec && (
                <CodecBadge codec={camera.video_codec} size="sm" showWarning={false} />
            )}
        </div>
    </div>
)}

// Fullscreen - Top bar (semua view)
{isFullscreen && (
    <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3">
            <h2>{camera.name}</h2>
            {camera.video_codec && (
                <CodecBadge codec={camera.video_codec} size="sm" showWarning={false} />
            )}
            <span>LIVE</span>
        </div>
    </div>
)}
```

## Device-Adaptive Video Player

### Device Tier Classification

| Tier | RAM | CPU Cores | Mobile RAM | Max Streams |
|------|-----|-----------|------------|-------------|
| Low | ≤ 2GB | ≤ 2 | ≤ 3GB | 2 |
| Medium | 2-4GB | 2-4 | 3-4GB | 3 |
| High | > 4GB | > 4 | > 4GB | 3 |

### HLS Configuration by Tier

```javascript
import { detectDeviceTier } from '../utils/deviceDetector';
import { getHLSConfig } from '../utils/hlsConfig';

const tier = detectDeviceTier();
const hlsConfig = getHLSConfig(tier);

const hls = new Hls(hlsConfig);
```

**Config Differences:**

| Setting | Low | Medium | High |
|---------|-----|--------|------|
| enableWorker | false | true | true |
| maxBufferLength | 15s | 25s | 30s |
| maxBufferSize | 30MB | 45MB | 60MB |
| startLevel | 0 (lowest) | -1 (auto) | -1 (auto) |

### Error Recovery

```javascript
import { createErrorRecovery } from '../utils/errorRecovery';

const recovery = createErrorRecovery(hls, {
    maxRetries: 3,
    onRecoveryFailed: () => setStatus('error')
});

recovery.handleError(errorData);
```

**Exponential backoff:** 1s → 2s → 4s → 8s max

### Visibility-Based Stream Control

```javascript
import { createVisibilityObserver } from '../utils/visibilityObserver';

const observer = createVisibilityObserver({ threshold: 0.1 });
observer.observe(videoElement, (isVisible) => {
    if (isVisible) {
        videoRef.current?.play();
    } else {
        // Pause after 5s when not visible
        setTimeout(() => videoRef.current?.pause(), 5000);
    }
});
```

### Multi-View Stream Management

```javascript
import { createMultiViewManager } from '../utils/multiViewManager';

const manager = createMultiViewManager();

// Add streams (respects device limits: 2 low, 3 medium/high)
manager.addStream(camera1);
manager.addStream(camera2);

// Initialize with staggered timing (100ms delay)
await manager.initializeAll(initStreamFn);

// Check capacity
console.log(manager.getMaxStreams()); // 2 or 3
console.log(manager.isAtCapacity());  // true/false
```

### Zoom/Pan Performance

```javascript
import { createRAFThrottle } from '../utils/rafThrottle';

// RAF throttle for smooth zoom/pan (max 60fps)
const { throttled: handleZoom, cancel } = createRAFThrottle((delta) => {
    const newZoom = Math.min(Math.max(1, zoom + delta), maxZoom);
    wrapperRef.current.style.transform = `scale(${newZoom})`;
});

// Use CSS transforms, not state updates
element.addEventListener('wheel', (e) => handleZoom(e.deltaY));

// Cleanup
useEffect(() => () => cancel(), []);
```

### Orientation Handling

```javascript
import { createOrientationObserver } from '../utils/orientationObserver';

const observer = createOrientationObserver({
    onOrientationChange: ({ isPortrait }) => {
        // Adapt layout WITHOUT reloading stream
        updateLayout(isPortrait ? 'portrait' : 'landscape');
    }
});

observer.start();
// Cleanup: observer.stop();
```

### Resource Cleanup

```javascript
useEffect(() => {
    return () => {
        // Destroy HLS instance
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        
        // Clear video source
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.src = '';
            videoRef.current.load();
        }
        
        // Clear timeouts
        clearTimeout(retryTimeoutRef.current);
        clearTimeout(pauseTimeoutRef.current);
    };
}, []);
```

## Performance Checklist

When implementing video player:

- [ ] Device tier detected on mount
- [ ] HLS config matches device capabilities
- [ ] Web workers disabled on low-end devices
- [ ] Buffer sizes appropriate for device tier
- [ ] Visibility observer pauses off-screen streams
- [ ] Error recovery uses exponential backoff
- [ ] Multi-view respects stream limits (2 low, 3 medium/high)
- [ ] Zoom/pan uses RAF throttling (max 60fps)
- [ ] Complete cleanup on unmount
- [ ] Brief buffers (<2s) don't show spinner
- [ ] Orientation changes don't reload streams

## Testing

Saat testing video player:

**Live Stream:**
1. Buka kamera di MapView → Cek info di atas video
2. Buka kamera di GridView → Cek info di bawah video
3. Klik fullscreen → Cek codec badge di top bar
4. Test dengan kamera H264 dan H265
5. Test di mobile (portrait & landscape)

**Playback Recording:**
1. Pilih kamera dari dropdown → Cek segment list
2. Pilih tanggal → Cek segment list update
3. Klik segment → Cek video load dan play
4. Test timeline seek → Cek validasi
5. Test speed control → Cek playback speed (0.5x - 2x)
6. Test download button → Cek file download
7. Test di mobile → Cek responsive controls

## Maintenance

Jika ada perubahan pada codec info display:
1. Update SEMUA komponen video player (MapView, LandingPage, Playback)
2. Test di semua view mode (normal, fullscreen, mobile)
