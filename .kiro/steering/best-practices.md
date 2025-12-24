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