# Best Practices & Development Guidelines

## Code Quality Standards

### Backend Best Practices (Fastify/Node.js)

#### Controller Pattern
```javascript
// ✅ Good - Clean controller with proper error handling
export async function getAllCameras(request, reply) {
    try {
        const cameras = query('SELECT * FROM cameras WHERE enabled = 1');
        return reply.send({ success: true, data: cameras });
    } catch (error) {
        console.error('Get cameras error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

// ❌ Bad - No error handling, inconsistent response
export async function getAllCameras(request, reply) {
    const cameras = query('SELECT * FROM cameras');
    reply.send(cameras);
}
```

#### Database Operations
```javascript
// ✅ Good - Parameterized queries, transactions
const createCamera = (name, rtspUrl) => {
    const stmt = db.prepare('INSERT INTO cameras (name, private_rtsp_url) VALUES (?, ?)');
    return stmt.run(name, rtspUrl);
};

// ❌ Bad - SQL injection risk
const createCamera = (name, rtspUrl) => {
    return db.exec(`INSERT INTO cameras (name, private_rtsp_url) VALUES ('${name}', '${rtspUrl}')`);
};
```

#### MediaMTX Integration
```javascript
// ✅ Good - Error handling and validation
async function syncCameras() {
    try {
        const cameras = query('SELECT * FROM cameras WHERE enabled = 1');
        
        for (const camera of cameras) {
            const pathName = `camera${camera.id}`;
            await mediaMtxService.createPath(pathName, {
                source: camera.private_rtsp_url,
                sourceOnDemand: true // IMPORTANT: Only pull when requested
            });
        }
    } catch (error) {
        console.error('MediaMTX sync error:', error);
    }
}
```

### Frontend Best Practices (React/Vite)

#### Component Structure
```jsx
// ✅ Good - Clean functional component with hooks
import { useState, useEffect } from 'react';
import { cameraService } from '../services/cameraService';

function CameraGrid() {
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchCameras = async () => {
            try {
                const response = await cameraService.getActiveCameras();
                setCameras(response.data);
            } catch (err) {
                setError('Failed to load cameras');
            } finally {
                setLoading(false);
            }
        };

        fetchCameras();
    }, []);

    if (loading) return <div className="animate-pulse">Loading...</div>;
    if (error) return <div className="text-red-500">{error}</div>;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cameras.map(camera => (
                <CameraCard key={camera.id} camera={camera} />
            ))}
        </div>
    );
}
```

#### Video Player Implementation
```jsx
// ✅ Good - Proper HLS.js integration with cleanup
import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

function VideoPlayer({ streamUrl, autoPlay = false }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);

    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;

        if (Hls.isSupported()) {
            hlsRef.current = new Hls({
                enableWorker: false,
                lowLatencyMode: true,
            });

            hlsRef.current.loadSource(streamUrl);
            hlsRef.current.attachMedia(videoRef.current);
        }

        // Cleanup function
        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [streamUrl]);

    return (
        <video
            ref={videoRef}
            className="w-full h-full object-contain"
            controls
            autoPlay={autoPlay}
            muted
        />
    );
}
```

#### Tailwind CSS Best Practices
```jsx
// ✅ Good - Responsive, semantic classes
<div className="bg-dark-900/90 backdrop-blur-md border border-dark-700/50 rounded-xl p-6 shadow-2xl">
    <h2 className="text-xl font-semibold text-white mb-4">Camera Management</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors">
            Add Camera
        </button>
    </div>
</div>

// ❌ Bad - Inline styles, non-responsive
<div style={{backgroundColor: '#1a1a1a', padding: '20px'}}>
    <h2 style={{color: 'white'}}>Camera Management</h2>
    <button style={{backgroundColor: '#0ea5e9', color: 'white', padding: '10px'}}>
        Add Camera
    </button>
</div>
```

## Security Best Practices

### Backend Security
```javascript
// ✅ Good - Input validation
export async function createCamera(request, reply) {
    const { name, private_rtsp_url } = request.body;

    // Validate inputs
    if (!name || typeof name !== 'string' || name.length > 100) {
        return reply.code(400).send({
            success: false,
            message: 'Invalid camera name'
        });
    }

    if (!private_rtsp_url || !private_rtsp_url.startsWith('rtsp://')) {
        return reply.code(400).send({
            success: false,
            message: 'Invalid RTSP URL'
        });
    }

    // ... rest of implementation
}
```

### Environment Variables
```javascript
// ✅ Good - Proper defaults and validation
export const config = {
    jwt: {
        secret: process.env.JWT_SECRET || (() => {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('JWT_SECRET is required in production');
            }
            return 'development-secret-not-for-production';
        })(),
        expiration: process.env.JWT_EXPIRATION || '24h',
    }
};
```

## Performance Optimization

### Database Optimization
```javascript
// ✅ Good - Prepared statements and indexes
const db = new Database('./data/cctv.db');

// Create indexes for better performance
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cameras_enabled ON cameras(enabled);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
`);

// Use prepared statements
const getCamerasStmt = db.prepare('SELECT * FROM cameras WHERE enabled = ? ORDER BY id');
const getActiveCameras = () => getCamerasStmt.all(1);
```

### Frontend Performance
```jsx
// ✅ Good - Lazy loading and memoization
import { lazy, Suspense, memo } from 'react';

const VideoPlayer = lazy(() => import('./VideoPlayer'));

const CameraCard = memo(({ camera }) => {
    return (
        <div className="bg-dark-800 rounded-lg overflow-hidden">
            <Suspense fallback={<div className="animate-pulse h-48 bg-dark-700" />}>
                <VideoPlayer streamUrl={camera.streamUrl} />
            </Suspense>
        </div>
    );
});
```

## Error Handling Patterns

### Backend Error Handling
```javascript
// ✅ Good - Centralized error handling
fastify.setErrorHandler((error, request, reply) => {
    // Log error with context
    fastify.log.error({
        error: error.message,
        stack: error.stack,
        url: request.url,
        method: request.method,
        ip: request.ip
    });

    // Return appropriate error response
    const statusCode = error.statusCode || 500;
    const message = statusCode === 500 ? 'Internal Server Error' : error.message;

    reply.code(statusCode).send({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
});
```

### Frontend Error Boundaries
```jsx
// ✅ Good - Error boundary component
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('Error caught by boundary:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="bg-red-900/20 border border-red-500 rounded-lg p-6 text-center">
                    <h2 className="text-red-400 text-lg font-semibold mb-2">Something went wrong</h2>
                    <p className="text-red-300">Please refresh the page or contact support</p>
                </div>
            );
        }

        return this.props.children;
    }
}
```

## Testing Guidelines

### Backend Testing
```javascript
// ✅ Good - Unit test example
import { test } from 'node:test';
import assert from 'node:assert';
import { createCamera } from '../controllers/cameraController.js';

test('createCamera should validate input', async () => {
    const mockRequest = {
        body: { name: '', private_rtsp_url: 'invalid-url' },
        user: { id: 1 },
        ip: '127.0.0.1'
    };

    const mockReply = {
        code: (statusCode) => ({
            send: (response) => {
                assert.strictEqual(statusCode, 400);
                assert.strictEqual(response.success, false);
                return response;
            }
        })
    };

    await createCamera(mockRequest, mockReply);
});
```

### Frontend Testing
```jsx
// ✅ Good - Component test example
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import CameraGrid from './CameraGrid';
import * as cameraService from '../services/cameraService';

vi.mock('../services/cameraService');

test('CameraGrid displays cameras', async () => {
    const mockCameras = [
        { id: 1, name: 'Camera 1', location: 'Front Door' }
    ];

    vi.mocked(cameraService.getActiveCameras).mockResolvedValue({
        data: mockCameras
    });

    render(<CameraGrid />);

    await waitFor(() => {
        expect(screen.getByText('Camera 1')).toBeInTheDocument();
    });
});
```

## Deployment Best Practices

### Environment-Specific Configurations
```javascript
// ✅ Good - Environment-aware configuration
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

export const config = {
    server: {
        port: process.env.PORT || (isDevelopment ? 3000 : 8080),
        host: process.env.HOST || (isDevelopment ? 'localhost' : '0.0.0.0'),
    },
    
    cors: {
        origin: isDevelopment 
            ? ['http://localhost:5173', 'http://localhost:3000']
            : process.env.CORS_ORIGIN?.split(',') || true, // Ubuntu 20.04: accept all
    },
    
    logging: {
        level: isDevelopment ? 'debug' : 'info',
        prettyPrint: isDevelopment,
    }
};
```

### Health Checks
```javascript
// ✅ Good - Comprehensive health check
fastify.get('/health', async (request, reply) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        checks: {}
    };

    // Database check
    try {
        db.prepare('SELECT 1').get();
        health.checks.database = 'ok';
    } catch (error) {
        health.checks.database = 'error';
        health.status = 'degraded';
    }

    // MediaMTX check
    try {
        await axios.get(`${config.mediamtx.apiUrl}/v3/config/global/get`);
        health.checks.mediamtx = 'ok';
    } catch (error) {
        health.checks.mediamtx = 'error';
        health.status = 'degraded';
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    return reply.code(statusCode).send(health);
});
```

## Monitoring and Logging

### Structured Logging
```javascript
// ✅ Good - Structured logging with context
fastify.log.info({
    event: 'camera_created',
    cameraId: result.lastInsertRowid,
    cameraName: name,
    userId: request.user.id,
    ip: request.ip,
    timestamp: new Date().toISOString()
}, 'New camera created successfully');
```

### Performance Monitoring
```javascript
// ✅ Good - Request timing middleware
fastify.addHook('onRequest', async (request) => {
    request.startTime = Date.now();
});

fastify.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - request.startTime;
    
    fastify.log.info({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration,
        ip: request.ip
    }, 'Request completed');
});
```

These best practices ensure maintainable, secure, and performant code across the entire CCTV system.


## Video Player Optimization Best Practices

This section documents the device-adaptive video player optimization approach implemented for RAF NET CCTV Hub. The goal is to ensure smooth video playback across all device types, from low-end mobile phones ("HP kentang") to high-end desktops.

### Core Principles

1. **Device-Adaptive Configuration** - Automatically detect device capabilities and apply appropriate settings
2. **Intelligent Resource Management** - Efficient memory and buffer management
3. **Graceful Degradation** - Maintain functionality even on limited hardware
4. **Progressive Enhancement** - Enable advanced features only on capable devices

### Device-Adaptive HLS Configuration

```javascript
// ✅ Good - Device-adaptive HLS configuration
import { detectDeviceTier } from '../utils/deviceDetector';
import { getHLSConfig } from '../utils/hlsConfig';

function VideoPlayer({ streamUrl }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);

    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;

        // Detect device capabilities and get appropriate config
        const tier = detectDeviceTier();
        const hlsConfig = getHLSConfig(tier);

        if (Hls.isSupported()) {
            hlsRef.current = new Hls(hlsConfig);
            hlsRef.current.loadSource(streamUrl);
            hlsRef.current.attachMedia(videoRef.current);
        }

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [streamUrl]);
}

// ❌ Bad - One-size-fits-all configuration
function VideoPlayer({ streamUrl }) {
    useEffect(() => {
        const hls = new Hls({
            enableWorker: true,  // May crash low-end devices
            maxBufferLength: 60, // Too much memory for low-end
        });
    }, [streamUrl]);
}
```

### Device Tier Classification

The system classifies devices into three tiers based on hardware capabilities:

| Tier | RAM | CPU Cores | Mobile RAM | Use Case |
|------|-----|-----------|------------|----------|
| Low | ≤ 2GB | ≤ 2 | ≤ 3GB | Budget phones, old devices |
| Medium | 2-4GB | 2-4 | 3-4GB | Mid-range devices |
| High | > 4GB | > 4 | > 4GB | Modern phones, desktops |

```javascript
// ✅ Good - Proper device detection
const detectDeviceTier = () => {
    const ram = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    // Low-end: RAM ≤ 2GB OR cores ≤ 2 OR mobile with RAM ≤ 3GB
    if (ram <= 2 || cores <= 2 || (isMobile && ram <= 3)) {
        return 'low';
    }
    // High-end: RAM > 4GB AND cores > 4
    if (ram > 4 && cores > 4) {
        return 'high';
    }
    return 'medium';
};
```

### HLS Configuration by Device Tier

```javascript
// ✅ Good - Tier-specific configurations
const HLS_CONFIGS = {
    low: {
        enableWorker: false,        // Disable worker for CPU savings
        lowLatencyMode: false,      // Stability over latency
        backBufferLength: 10,       // Minimal back buffer
        maxBufferLength: 15,        // Small forward buffer
        maxMaxBufferLength: 30,
        maxBufferSize: 30 * 1000 * 1000, // 30MB max
        startLevel: 0,              // Start with lowest quality
        abrBandWidthFactor: 0.7,    // Conservative bandwidth usage
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 2000,
    },
    medium: {
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 20,
        maxBufferLength: 25,
        maxMaxBufferLength: 45,
        maxBufferSize: 45 * 1000 * 1000, // 45MB max
        startLevel: -1,             // Auto quality
        abrBandWidthFactor: 0.8,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1500,
    },
    high: {
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000, // 60MB max
        startLevel: -1,             // Auto quality
        abrBandWidthFactor: 0.9,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
    }
};
```

### Error Recovery with Exponential Backoff

```javascript
// ✅ Good - Exponential backoff for error recovery
const getBackoffDelay = (retryCount) => {
    return Math.min(1000 * Math.pow(2, retryCount), 8000); // 1s, 2s, 4s, 8s max
};

hls.on(Hls.Events.ERROR, (event, data) => {
    if (data.fatal) {
        switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
                if (retryCount < maxRetries) {
                    const delay = getBackoffDelay(retryCount);
                    setTimeout(() => {
                        hls.startLoad();
                        retryCount++;
                    }, delay);
                }
                break;
            case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError(); // Try recovery first
                break;
            default:
                setStatus('error');
                break;
        }
    }
});

// ❌ Bad - Fixed retry delay
hls.on(Hls.Events.ERROR, (event, data) => {
    if (data.fatal) {
        setTimeout(() => hls.startLoad(), 1000); // Always 1s, no limit
    }
});
```

### Visibility-Based Stream Control

```javascript
// ✅ Good - Pause streams when not visible
const useVisibilityObserver = (videoRef, hlsRef) => {
    const pauseTimeoutRef = useRef(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    // Resume when visible
                    clearTimeout(pauseTimeoutRef.current);
                    videoRef.current?.play();
                } else {
                    // Pause after 5s when not visible
                    pauseTimeoutRef.current = setTimeout(() => {
                        videoRef.current?.pause();
                    }, 5000);
                }
            },
            { threshold: 0.1 }
        );

        if (videoRef.current) {
            observer.observe(videoRef.current);
        }

        return () => {
            observer.disconnect();
            clearTimeout(pauseTimeoutRef.current);
        };
    }, []);
};

// ❌ Bad - Always streaming even when not visible
// (wastes bandwidth and device resources)
```

### Multi-View Stream Management

```javascript
// ✅ Good - Staggered initialization and limits
import { createMultiViewManager, staggeredInitialize } from '../utils/multiViewManager';

const initializeMultiView = async (cameras, deviceTier) => {
    const manager = createMultiViewManager();
    const maxStreams = manager.getMaxStreams(); // 2 for low, 3 for medium/high
    const camerasToInit = cameras.slice(0, maxStreams);
    
    // Stagger initialization to prevent CPU spike (100ms delay)
    await staggeredInitialize(camerasToInit, initStream, {
        delayMs: 100,
        onError: (camera, error) => {
            // Error isolation - one failure doesn't affect others
            console.error(`Stream ${camera.id} failed:`, error);
        }
    });
};

// ❌ Bad - Initialize all at once
const initializeMultiView = (cameras) => {
    cameras.forEach(camera => initializeStream(camera)); // CPU spike!
};
```

### Zoom/Pan Performance with RAF Throttling

```javascript
// ✅ Good - Use CSS transforms with RAF throttling
import { createRAFThrottle, createTransformThrottle } from '../utils/rafThrottle';

// Option 1: Generic RAF throttle
const { throttled: handleZoom, cancel } = createRAFThrottle((delta) => {
    const newZoom = Math.min(Math.max(1, zoom + delta), maxZoom);
    wrapperRef.current.style.transform = `scale(${newZoom})`;
});

// Option 2: Specialized transform throttle
const transformer = createTransformThrottle(wrapperRef.current);
transformer.update(scale, panX, panY); // Max 60fps updates

// ❌ Bad - Direct state updates causing re-renders
const handleZoom = (delta) => {
    setZoom(prev => prev + delta); // Causes full re-render
};
```

### Resource Cleanup

```javascript
// ✅ Good - Complete cleanup on unmount
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
        
        // Clear any pending timeouts
        clearTimeout(retryTimeoutRef.current);
        clearTimeout(pauseTimeoutRef.current);
    };
}, []);

// ❌ Bad - Incomplete cleanup (memory leak)
useEffect(() => {
    return () => {
        hlsRef.current?.destroy(); // Missing video cleanup
    };
}, []);
```

### Brief Buffer Handling

```javascript
// ✅ Good - Don't show spinner for brief buffers
const [showSpinner, setShowSpinner] = useState(false);
const bufferTimeoutRef = useRef(null);

const handleWaiting = () => {
    // Only show spinner after 2 seconds of buffering
    bufferTimeoutRef.current = setTimeout(() => {
        setShowSpinner(true);
    }, 2000);
};

const handlePlaying = () => {
    clearTimeout(bufferTimeoutRef.current);
    setShowSpinner(false);
};

// ❌ Bad - Immediate spinner (annoying UX)
const handleWaiting = () => {
    setShowSpinner(true); // Shows spinner for every tiny buffer
};
```

### Adaptive Quality Management

```javascript
// ✅ Good - Bandwidth-based quality adaptation
import { createAdaptiveQuality } from '../utils/adaptiveQuality';

const aq = createAdaptiveQuality(hls, {
    lowBandwidthThreshold: 500000,  // 500kbps
    highBandwidthThreshold: 2000000, // 2Mbps
    onQualityChange: (level, bandwidth) => {
        console.log(`Quality changed to level ${level} at ${bandwidth}bps`);
    }
});

aq.start();
// On cleanup: aq.stop();
```

### Mobile-Specific Optimizations

```javascript
// ✅ Good - Handle orientation changes without stream reload
import { createOrientationObserver } from '../utils/orientationObserver';

const orientationObserver = createOrientationObserver({
    onOrientationChange: ({ orientation, isPortrait }) => {
        // Adapt layout without reloading stream
        updateLayout(isPortrait ? 'portrait' : 'landscape');
    }
});

orientationObserver.start();
// On cleanup: orientationObserver.stop();

// ✅ Good - Use passive event listeners for touch
element.addEventListener('touchmove', handleTouch, { passive: true });
```

### Performance Checklist

When implementing video player features, ensure:

- [ ] Device tier is detected on component mount
- [ ] HLS config matches device capabilities
- [ ] Web workers disabled on low-end devices
- [ ] Buffer sizes appropriate for device tier
- [ ] Visibility observer pauses off-screen streams
- [ ] Error recovery uses exponential backoff
- [ ] Multi-view respects stream limits (2 low, 3 medium/high)
- [ ] Zoom/pan uses RAF throttling (max 60fps)
- [ ] Complete cleanup on unmount (HLS, video src, timeouts)
- [ ] Brief buffers (<2s) don't show spinner
- [ ] Orientation changes don't reload streams

These video player best practices ensure smooth playback across all device types, from low-end mobile phones to high-end desktops.
