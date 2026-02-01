# Analisa Recording dan Playback System

## 1. OVERVIEW SISTEM

### 1.1 Tujuan
Sistem recording dan playback untuk RAF NET CCTV Hub memungkinkan:
- Recording otomatis stream RTSP ke file video
- Penyimpanan recording dengan durasi konfigurabel
- Playback recording melalui web interface
- Management recording (start/stop, cleanup)

### 1.2 Komponen Utama
```
┌─────────────────────────────────────────────────────────┐
│                    RECORDING SYSTEM                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Camera (RTSP) → MediaMTX → Recording Service           │
│                              ↓                           │
│                         File Storage                     │
│                              ↓                           │
│                    Playback Controller                   │
│                              ↓                           │
│                      Frontend Player                     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 1.3 Technology Stack
- **Recording**: FFmpeg via MediaMTX recording feature
- **Storage**: Local filesystem (MP4/HLS segments)
- **Playback**: Native HTML5 video player atau HLS.js
- **Management**: Node.js backend service


## 2. DATABASE SCHEMA

### 2.1 Cameras Table (Existing + Recording Fields)
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
    status TEXT DEFAULT 'active',
    is_online INTEGER DEFAULT 1,
    is_tunnel INTEGER DEFAULT 0,
    stream_key TEXT UNIQUE,
    video_codec TEXT DEFAULT 'h264',
    
    -- Recording fields
    enable_recording INTEGER DEFAULT 0,
    recording_duration_hours INTEGER DEFAULT 5,
    is_recording INTEGER DEFAULT 0,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL
);
```

**Field Descriptions:**
- `enable_recording`: Toggle recording untuk kamera (0=off, 1=on)
- `recording_duration_hours`: Durasi penyimpanan recording (default 5 jam)
- `is_recording`: Status recording saat ini (0=stopped, 1=recording)


### 2.2 Recordings Table (New)
```sql
CREATE TABLE recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    duration_seconds INTEGER,
    file_size_bytes INTEGER,
    status TEXT DEFAULT 'recording',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
);

CREATE INDEX idx_recordings_camera_id ON recordings(camera_id);
CREATE INDEX idx_recordings_start_time ON recordings(start_time);
CREATE INDEX idx_recordings_status ON recordings(status);
```

**Field Descriptions:**
- `status`: 'recording', 'completed', 'error', 'deleted'
- `duration_seconds`: Durasi recording dalam detik
- `file_size_bytes`: Ukuran file untuk monitoring storage


## 3. RECORDING LOGIC

### 3.1 Recording Service Architecture
```javascript
// backend/services/recordingService.js

class RecordingService {
    constructor() {
        this.activeRecordings = new Map(); // camera_id -> recording_info
        this.cleanupInterval = null;
    }
    
    // Start recording untuk camera
    async startRecording(cameraId) {
        // 1. Validate camera exists dan enabled
        // 2. Check if already recording
        // 3. Create recording entry di database
        // 4. Start MediaMTX recording via API
        // 5. Update camera.is_recording = 1
        // 6. Track di activeRecordings Map
    }
    
    // Stop recording untuk camera
    async stopRecording(cameraId) {
        // 1. Stop MediaMTX recording via API
        // 2. Update recording entry (end_time, duration, file_size)
        // 3. Update camera.is_recording = 0
        // 4. Remove dari activeRecordings Map
    }
    
    // Auto-cleanup old recordings
    async cleanupOldRecordings() {
        // 1. Query recordings older than retention period
        // 2. Delete files dari filesystem
        // 3. Update database status = 'deleted'
    }
}
```


### 3.2 MediaMTX Recording Integration

**MediaMTX Recording API:**
```bash
# Start recording
POST /v3/config/paths/patch/{pathName}
{
    "record": true,
    "recordPath": "/var/www/rafnet-cctv/recordings/%path/%Y-%m-%d_%H-%M-%S",
    "recordFormat": "mp4",
    "recordSegmentDuration": "1h"
}

# Stop recording
POST /v3/config/paths/patch/{pathName}
{
    "record": false
}
```

**Recording Path Structure:**
```
/var/www/rafnet-cctv/recordings/
├── camera1/
│   ├── 2024-02-01_10-00-00.mp4
│   ├── 2024-02-01_11-00-00.mp4
│   └── 2024-02-01_12-00-00.mp4
├── camera2/
│   ├── 2024-02-01_10-00-00.mp4
│   └── 2024-02-01_11-00-00.mp4
└── ...
```


### 3.3 Recording Workflow

**Flow Diagram:**
```
┌─────────────────────────────────────────────────────────┐
│ 1. Admin enables recording untuk camera                 │
│    (enable_recording = 1)                               │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 2. recordingService.startRecording(cameraId)            │
│    - Create recording entry (status='recording')        │
│    - Call MediaMTX API to enable recording              │
│    - Update camera.is_recording = 1                     │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 3. MediaMTX records stream to MP4 files                 │
│    - Segment duration: 1 hour per file                  │
│    - Auto-rotate files setiap jam                       │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Cleanup service runs periodically (every 1 hour)     │
│    - Delete recordings older than retention period      │
│    - Update database status = 'deleted'                 │
└─────────────────────────────────────────────────────────┘
```


### 3.4 Auto-Start Recording Logic

**Trigger Points:**
1. **Camera Created** dengan `enable_recording = 1`
2. **Camera Updated** dari `enable_recording = 0` → `1`
3. **Server Startup** - resume recording untuk cameras dengan `enable_recording = 1`

**Implementation di cameraController.js:**
```javascript
// CREATE CAMERA
if (isEnabled && isRecordingEnabled) {
    const { recordingService } = await import('../services/recordingService.js');
    await recordingService.startRecording(result.lastInsertRowid);
}

// UPDATE CAMERA
if (enable_recording !== undefined) {
    const newRecordingEnabled = enable_recording === true || enable_recording === 1;
    const oldRecordingEnabled = existingCamera.enable_recording === 1;
    
    if (newRecordingEnabled !== oldRecordingEnabled) {
        if (newRecordingEnabled && cameraEnabled) {
            await recordingService.startRecording(parseInt(id));
        } else if (!newRecordingEnabled) {
            await recordingService.stopRecording(parseInt(id));
        }
    }
}
```


## 4. RECORDING SERVICE IMPLEMENTATION

### 4.1 Service Structure
```javascript
// backend/services/recordingService.js
import axios from 'axios';
import { query, queryOne, execute } from '../database/database.js';
import { config } from '../config/config.js';
import fs from 'fs/promises';
import path from 'path';

class RecordingService {
    constructor() {
        this.activeRecordings = new Map();
        this.cleanupInterval = null;
        this.recordingsPath = '/var/www/rafnet-cctv/recordings';
        this.mediaMtxApiUrl = config.mediamtx.apiUrl || 'http://localhost:9997';
    }

    /**
     * Initialize recording service
     * - Resume recordings for enabled cameras
     * - Start cleanup scheduler
     */
    async initialize() {
        console.log('[Recording] Initializing recording service...');
        
        // Create recordings directory if not exists
        await this.ensureRecordingsDirectory();
        
        // Resume recordings for cameras with enable_recording = 1
        await this.resumeRecordings();
        
        // Start cleanup scheduler (every 1 hour)
        this.startCleanupScheduler();
        
        console.log('[Recording] Recording service initialized');
    }


    /**
     * Start recording for a camera
     */
    async startRecording(cameraId) {
        try {
            // Get camera info
            const camera = queryOne(
                'SELECT id, name, stream_key, enable_recording, enabled FROM cameras WHERE id = ?',
                [cameraId]
            );
            
            if (!camera) {
                throw new Error(`Camera ${cameraId} not found`);
            }
            
            if (!camera.enabled) {
                throw new Error(`Camera ${cameraId} is disabled`);
            }
            
            if (!camera.enable_recording) {
                throw new Error(`Recording not enabled for camera ${cameraId}`);
            }
            
            // Check if already recording
            if (this.activeRecordings.has(cameraId)) {
                console.log(`[Recording] Camera ${cameraId} already recording`);
                return { success: true, message: 'Already recording' };
            }
            
            // Create recording entry
            const startTime = new Date().toISOString();
            const result = execute(
                'INSERT INTO recordings (camera_id, filename, filepath, start_time, status) VALUES (?, ?, ?, ?, ?)',
                [cameraId, '', '', startTime, 'recording']
            );
            
            const recordingId = result.lastInsertRowid;


            // Enable recording via MediaMTX API
            const pathName = camera.stream_key;
            const recordPath = path.join(
                this.recordingsPath,
                `camera${cameraId}`,
                '%Y-%m-%d_%H-%M-%S'
            );
            
            await axios.post(
                `${this.mediaMtxApiUrl}/v3/config/paths/patch/${pathName}`,
                {
                    record: true,
                    recordPath: recordPath,
                    recordFormat: 'mp4',
                    recordSegmentDuration: '1h'
                },
                { timeout: 5000 }
            );
            
            // Update camera status
            execute('UPDATE cameras SET is_recording = 1 WHERE id = ?', [cameraId]);
            
            // Track active recording
            this.activeRecordings.set(cameraId, {
                recordingId,
                startTime,
                pathName
            });
            
            console.log(`[Recording] Started recording for camera ${cameraId}`);
            return { success: true, recordingId };
            
        } catch (error) {
            console.error(`[Recording] Failed to start recording for camera ${cameraId}:`, error);
            return { success: false, error: error.message };
        }
    }


    /**
     * Stop recording for a camera
     */
    async stopRecording(cameraId) {
        try {
            const recordingInfo = this.activeRecordings.get(cameraId);
            
            if (!recordingInfo) {
                console.log(`[Recording] Camera ${cameraId} not recording`);
                return { success: true, message: 'Not recording' };
            }
            
            // Disable recording via MediaMTX API
            await axios.post(
                `${this.mediaMtxApiUrl}/v3/config/paths/patch/${recordingInfo.pathName}`,
                { record: false },
                { timeout: 5000 }
            );
            
            // Update recording entry
            const endTime = new Date().toISOString();
            const startTime = new Date(recordingInfo.startTime);
            const durationSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
            
            execute(
                'UPDATE recordings SET end_time = ?, duration_seconds = ?, status = ? WHERE id = ?',
                [endTime, durationSeconds, 'completed', recordingInfo.recordingId]
            );
            
            // Update camera status
            execute('UPDATE cameras SET is_recording = 0 WHERE id = ?', [cameraId]);
            
            // Remove from active recordings
            this.activeRecordings.delete(cameraId);
            
            console.log(`[Recording] Stopped recording for camera ${cameraId}`);
            return { success: true };
            
        } catch (error) {
            console.error(`[Recording] Failed to stop recording for camera ${cameraId}:`, error);
            return { success: false, error: error.message };
        }
    }


    /**
     * Cleanup old recordings based on retention period
     */
    async cleanupOldRecordings() {
        try {
            console.log('[Recording] Running cleanup for old recordings...');
            
            // Get all cameras with their retention periods
            const cameras = query(
                'SELECT id, recording_duration_hours FROM cameras WHERE enable_recording = 1'
            );
            
            let deletedCount = 0;
            let freedBytes = 0;
            
            for (const camera of cameras) {
                const retentionHours = camera.recording_duration_hours || 5;
                const cutoffTime = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
                
                // Get old recordings for this camera
                const oldRecordings = query(
                    `SELECT id, filepath, file_size_bytes 
                     FROM recordings 
                     WHERE camera_id = ? 
                     AND start_time < ? 
                     AND status != 'deleted'`,
                    [camera.id, cutoffTime.toISOString()]
                );
                
                for (const recording of oldRecordings) {
                    try {
                        // Delete file if exists
                        if (recording.filepath) {
                            await fs.unlink(recording.filepath);
                            freedBytes += recording.file_size_bytes || 0;
                        }
                        
                        // Update database
                        execute(
                            'UPDATE recordings SET status = ? WHERE id = ?',
                            ['deleted', recording.id]
                        );
                        
                        deletedCount++;
                    } catch (err) {
                        console.error(`[Recording] Failed to delete recording ${recording.id}:`, err);
                    }
                }
            }
            
            if (deletedCount > 0) {
                const freedMB = (freedBytes / (1024 * 1024)).toFixed(2);
                console.log(`[Recording] Cleanup complete: ${deletedCount} recordings deleted, ${freedMB} MB freed`);
            }
            
        } catch (error) {
            console.error('[Recording] Cleanup error:', error);
        }
    }


    /**
     * Resume recordings on server startup
     */
    async resumeRecordings() {
        try {
            const cameras = query(
                'SELECT id FROM cameras WHERE enabled = 1 AND enable_recording = 1'
            );
            
            console.log(`[Recording] Resuming recordings for ${cameras.length} cameras...`);
            
            for (const camera of cameras) {
                await this.startRecording(camera.id);
            }
            
        } catch (error) {
            console.error('[Recording] Failed to resume recordings:', error);
        }
    }
    
    /**
     * Start cleanup scheduler
     */
    startCleanupScheduler() {
        // Run cleanup every 1 hour
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldRecordings();
        }, 60 * 60 * 1000);
        
        // Run initial cleanup after 5 minutes
        setTimeout(() => {
            this.cleanupOldRecordings();
        }, 5 * 60 * 1000);
    }
    
    /**
     * Ensure recordings directory exists
     */
    async ensureRecordingsDirectory() {
        try {
            await fs.mkdir(this.recordingsPath, { recursive: true });
        } catch (error) {
            console.error('[Recording] Failed to create recordings directory:', error);
        }
    }
}

export const recordingService = new RecordingService();
```


## 5. PLAYBACK LOGIC

### 5.1 Playback Architecture
```
┌─────────────────────────────────────────────────────────┐
│                    PLAYBACK FLOW                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. User selects camera + date                          │
│                ↓                                         │
│  2. Backend queries recordings table                     │
│                ↓                                         │
│  3. Return list of recording segments                    │
│                ↓                                         │
│  4. User selects segment                                 │
│                ↓                                         │
│  5. Backend serves video file via secure route           │
│                ↓                                         │
│  6. Frontend plays video with HTML5 player               │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Playback Controller
```javascript
// backend/controllers/playbackController.js
import { query, queryOne } from '../database/database.js';
import { logAdminAction } from '../services/securityAuditLogger.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Get list of cameras with recordings
 */
export async function getCamerasWithRecordings(request, reply) {
    try {
        const cameras = query(`
            SELECT DISTINCT c.id, c.name, c.location, c.area_name
            FROM cameras c
            INNER JOIN recordings r ON c.id = r.camera_id
            WHERE r.status = 'completed'
            ORDER BY c.name ASC
        `);
        
        return reply.send({ success: true, data: cameras });
    } catch (error) {
        console.error('Get cameras with recordings error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}


/**
 * Get recordings for a camera on a specific date
 */
export async function getRecordingsByDate(request, reply) {
    try {
        const { cameraId } = request.params;
        const { date } = request.query; // Format: YYYY-MM-DD
        
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return reply.code(400).send({ 
                success: false, 
                message: 'Invalid date format. Use YYYY-MM-DD' 
            });
        }
        
        // Get recordings for the date
        const startOfDay = `${date} 00:00:00`;
        const endOfDay = `${date} 23:59:59`;
        
        const recordings = query(`
            SELECT 
                id, 
                filename, 
                start_time, 
                end_time, 
                duration_seconds,
                file_size_bytes
            FROM recordings
            WHERE camera_id = ?
            AND start_time >= ?
            AND start_time <= ?
            AND status = 'completed'
            ORDER BY start_time ASC
        `, [cameraId, startOfDay, endOfDay]);
        
        return reply.send({ success: true, data: recordings });
    } catch (error) {
        console.error('Get recordings by date error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}


/**
 * Stream recording file
 * Supports range requests for seeking
 */
export async function streamRecording(request, reply) {
    try {
        const { recordingId } = request.params;
        
        // Get recording info
        const recording = queryOne(
            'SELECT id, camera_id, filepath, file_size_bytes FROM recordings WHERE id = ? AND status = ?',
            [recordingId, 'completed']
        );
        
        if (!recording) {
            return reply.code(404).send({ success: false, message: 'Recording not found' });
        }
        
        // Check if file exists
        try {
            await fs.access(recording.filepath);
        } catch {
            return reply.code(404).send({ success: false, message: 'Recording file not found' });
        }
        
        // Log playback access
        logAdminAction({
            action: 'recording_played',
            recording_id: recordingId,
            camera_id: recording.camera_id,
            userId: request.user.id
        }, request);
        
        // Handle range requests for seeking
        const range = request.headers.range;
        const fileSize = recording.file_size_bytes;
        
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;
            
            const fileStream = fs.createReadStream(recording.filepath, { start, end });
            
            reply.code(206)
                .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
                .header('Accept-Ranges', 'bytes')
                .header('Content-Length', chunkSize)
                .header('Content-Type', 'video/mp4')
                .send(fileStream);
        } else {
            // Full file
            const fileStream = fs.createReadStream(recording.filepath);
            
            reply
                .header('Content-Length', fileSize)
                .header('Content-Type', 'video/mp4')
                .send(fileStream);
        }
        
    } catch (error) {
        console.error('Stream recording error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
```


### 5.3 Playback Routes
```javascript
// backend/routes/playbackRoutes.js
import { 
    getCamerasWithRecordings, 
    getRecordingsByDate, 
    streamRecording 
} from '../controllers/playbackController.js';
import { authenticate } from '../middleware/authMiddleware.js';

export default async function playbackRoutes(fastify) {
    // Get cameras that have recordings
    fastify.get('/playback/cameras', {
        preHandler: [authenticate]
    }, getCamerasWithRecordings);
    
    // Get recordings for a camera on specific date
    fastify.get('/playback/recordings/:cameraId', {
        preHandler: [authenticate]
    }, getRecordingsByDate);
    
    // Stream recording file (supports range requests)
    fastify.get('/playback/stream/:recordingId', {
        preHandler: [authenticate]
    }, streamRecording);
}
```

### 5.4 Register Routes di server.js
```javascript
// backend/server.js
import playbackRoutes from './routes/playbackRoutes.js';

// Register routes
await fastify.register(playbackRoutes, { prefix: '/api' });

// Initialize recording service
import { recordingService } from './services/recordingService.js';
await recordingService.initialize();
```


## 6. FRONTEND PLAYBACK IMPLEMENTATION

### 6.1 Playback Page Structure
```jsx
// frontend/src/pages/Playback.jsx
import { useState, useEffect, useRef } from 'react';
import { playbackService } from '../services/playbackService';

function Playback() {
    const [cameras, setCameras] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [recordings, setRecordings] = useState([]);
    const [selectedRecording, setSelectedRecording] = useState(null);
    const [loading, setLoading] = useState(false);
    const videoRef = useRef(null);
    
    // State untuk video controls
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <div className="bg-white dark:bg-gray-800 shadow">
                <div className="max-w-7xl mx-auto px-4 py-6">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                        Playback Recording
                    </h1>
                </div>
            </div>
            
            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Panel - Camera & Date Selection */}
                    <div className="lg:col-span-1">
                        <CameraSelector />
                        <DatePicker />
                        <RecordingList />
                    </div>
                    
                    {/* Right Panel - Video Player */}
                    <div className="lg:col-span-2">
                        <VideoPlayer />
                    </div>
                </div>
            </div>
        </div>
    );
}
```


### 6.2 Video Player Component
```jsx
// Video Player dengan custom controls
function VideoPlayer({ recording }) {
    const videoRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [volume, setVolume] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);
    
    // Load video when recording changes
    useEffect(() => {
        if (recording && videoRef.current) {
            const streamUrl = `/api/playback/stream/${recording.id}`;
            videoRef.current.src = streamUrl;
            videoRef.current.load();
        }
    }, [recording]);
    
    // Video event handlers
    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration);
        }
    };
    
    const handleTimeUpdate = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
        }
    };
    
    const handlePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };
    
    const handleSeek = (time) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };
    
    const handleSpeedChange = (speed) => {
        if (videoRef.current) {
            videoRef.current.playbackRate = speed;
            setPlaybackSpeed(speed);
        }
    };
    
    const handleVolumeChange = (vol) => {
        if (videoRef.current) {
            videoRef.current.volume = vol;
            setVolume(vol);
        }
    };
    
    const handleFullscreen = () => {
        if (!isFullscreen) {
            videoRef.current?.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
        setIsFullscreen(!isFullscreen);
    };


    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };
    
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            {/* Video Element */}
            <div className="relative aspect-video bg-black">
                <video
                    ref={videoRef}
                    className="w-full h-full"
                    onLoadedMetadata={handleLoadedMetadata}
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                />
                
                {!recording && (
                    <div className="absolute inset-0 flex items-center justify-center text-white">
                        <p>Pilih recording untuk diputar</p>
                    </div>
                )}
            </div>
            
            {/* Custom Controls */}
            <div className="p-4 bg-gray-100 dark:bg-gray-900">
                {/* Timeline */}
                <div className="mb-4">
                    <input
                        type="range"
                        min="0"
                        max={duration || 0}
                        value={currentTime}
                        onChange={(e) => handleSeek(parseFloat(e.target.value))}
                        className="w-full"
                    />
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mt-1">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>
                
                {/* Control Buttons */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {/* Play/Pause */}
                        <button
                            onClick={handlePlayPause}
                            className="p-2 rounded-lg bg-sky-500 text-white hover:bg-sky-600"
                        >
                            {isPlaying ? <PauseIcon /> : <PlayIcon />}
                        </button>
                        
                        {/* Speed Control */}
                        <select
                            value={playbackSpeed}
                            onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                            className="px-3 py-1 rounded-lg border"
                        >
                            <option value="0.5">0.5x</option>
                            <option value="1">1x</option>
                            <option value="1.5">1.5x</option>
                            <option value="2">2x</option>
                        </select>
                        
                        {/* Volume */}
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={volume}
                            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                            className="w-24"
                        />
                    </div>
                    
                    <div className="flex items-center gap-3">
                        {/* Download */}
                        <button
                            onClick={() => window.open(`/api/playback/stream/${recording?.id}`, '_blank')}
                            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
                            title="Download"
                        >
                            <DownloadIcon />
                        </button>
                        
                        {/* Fullscreen */}
                        <button
                            onClick={handleFullscreen}
                            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
                        >
                            <FullscreenIcon />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
```


### 6.3 Playback Service
```javascript
// frontend/src/services/playbackService.js
import apiClient from './apiClient';

export const playbackService = {
    /**
     * Get list of cameras with recordings
     */
    async getCamerasWithRecordings() {
        const response = await apiClient.get('/playback/cameras');
        return response.data;
    },
    
    /**
     * Get recordings for a camera on specific date
     */
    async getRecordingsByDate(cameraId, date) {
        const response = await apiClient.get(`/playback/recordings/${cameraId}`, {
            params: { date }
        });
        return response.data;
    },
    
    /**
     * Get stream URL for recording
     */
    getStreamUrl(recordingId) {
        return `/api/playback/stream/${recordingId}`;
    }
};
```


## 7. ADMIN MANAGEMENT

### 7.1 Recording Management UI (Camera Management Page)
```jsx
// Tambahkan recording controls di CameraManagement.jsx

// Form fields untuk recording
<div>
    <label className="flex items-center gap-2">
        <input
            type="checkbox"
            checked={formData.enable_recording}
            onChange={(e) => setFormData({ 
                ...formData, 
                enable_recording: e.target.checked 
            })}
            className="rounded"
        />
        <span>Enable Recording</span>
    </label>
</div>

{formData.enable_recording && (
    <div>
        <label className="block text-sm font-medium mb-2">
            Recording Duration (hours)
        </label>
        <input
            type="number"
            min="1"
            max="168"
            value={formData.recording_duration_hours}
            onChange={(e) => setFormData({ 
                ...formData, 
                recording_duration_hours: parseInt(e.target.value) 
            })}
            className="w-full px-4 py-2 rounded-lg border"
        />
        <p className="text-xs text-gray-500 mt-1">
            Recordings older than this will be automatically deleted
        </p>
    </div>
)}

// Display recording status di camera list
<div className="flex items-center gap-2">
    {camera.is_recording && (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500 text-white text-xs">
            <span className="animate-pulse">●</span>
            Recording
        </span>
    )}
</div>
```


### 7.2 Recording Statistics (Dashboard)
```jsx
// Tambahkan di Dashboard.jsx

const [recordingStats, setRecordingStats] = useState({
    totalRecordings: 0,
    activeRecordings: 0,
    totalStorageUsed: 0,
    oldestRecording: null
});

useEffect(() => {
    const fetchRecordingStats = async () => {
        const response = await adminService.getRecordingStats();
        setRecordingStats(response.data);
    };
    fetchRecordingStats();
}, []);

// Display stats
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
    <StatCard
        title="Active Recordings"
        value={recordingStats.activeRecordings}
        icon={<RecordIcon />}
        color="red"
    />
    <StatCard
        title="Total Recordings"
        value={recordingStats.totalRecordings}
        icon={<VideoIcon />}
        color="blue"
    />
    <StatCard
        title="Storage Used"
        value={formatBytes(recordingStats.totalStorageUsed)}
        icon={<StorageIcon />}
        color="purple"
    />
</div>
```


## 8. SECURITY CONSIDERATIONS

### 8.1 Access Control
- **Recording Management**: Admin only (JWT authentication required)
- **Playback Access**: Admin only (JWT authentication required)
- **File Serving**: Authenticated requests only, validate recording ownership
- **Audit Logging**: Log all playback access dengan `logAdminAction`

### 8.2 File Security
```javascript
// Validate file path to prevent directory traversal
const validateFilePath = (filepath) => {
    const normalizedPath = path.normalize(filepath);
    const recordingsPath = '/var/www/rafnet-cctv/recordings';
    
    if (!normalizedPath.startsWith(recordingsPath)) {
        throw new Error('Invalid file path');
    }
    
    return normalizedPath;
};

// Use in streamRecording controller
const safePath = validateFilePath(recording.filepath);
```

### 8.3 Rate Limiting
```javascript
// Apply stricter rate limits for playback endpoints
fastify.register(rateLimit, {
    max: 10, // 10 requests
    timeWindow: '1 minute',
    keyGenerator: (request) => request.user.id
});
```


## 9. STORAGE MANAGEMENT

### 9.1 Storage Calculation
```javascript
// Calculate total storage used
async function calculateStorageUsed() {
    const recordings = query(
        'SELECT SUM(file_size_bytes) as total FROM recordings WHERE status != ?',
        ['deleted']
    );
    
    return recordings[0]?.total || 0;
}

// Estimate storage requirements
// Formula: cameras × hours × bitrate
// Example: 10 cameras × 5 hours × 2 Mbps = 45 GB
const estimateStorage = (cameraCount, retentionHours, bitrateMbps = 2) => {
    const bytesPerSecond = (bitrateMbps * 1024 * 1024) / 8;
    const totalSeconds = cameraCount * retentionHours * 3600;
    const totalBytes = totalSeconds * bytesPerSecond;
    
    return {
        bytes: totalBytes,
        gigabytes: (totalBytes / (1024 * 1024 * 1024)).toFixed(2)
    };
};
```

### 9.2 Storage Monitoring
```javascript
// Monitor disk space
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function checkDiskSpace() {
    try {
        const { stdout } = await execAsync('df -h /var/www/rafnet-cctv/recordings');
        // Parse output untuk get available space
        // Alert jika space < 10%
    } catch (error) {
        console.error('Failed to check disk space:', error);
    }
}
```


## 10. PERFORMANCE OPTIMIZATION

### 10.1 Recording Performance
- **Segment Duration**: 1 hour per file (balance antara file size dan manageability)
- **Format**: MP4 (widely supported, good compression)
- **Storage**: Local filesystem (fast access, simple management)
- **Codec**: Copy stream codec (no transcoding overhead)

### 10.2 Playback Performance
- **Range Requests**: Support HTTP range requests untuk seeking
- **Streaming**: Stream file chunks instead of loading entire file
- **Caching**: Browser caches video segments
- **Progressive Download**: Video plays while downloading

### 10.3 Database Optimization
```sql
-- Indexes untuk fast queries
CREATE INDEX idx_recordings_camera_id ON recordings(camera_id);
CREATE INDEX idx_recordings_start_time ON recordings(start_time);
CREATE INDEX idx_recordings_status ON recordings(status);

-- Composite index untuk date range queries
CREATE INDEX idx_recordings_camera_date ON recordings(camera_id, start_time);
```


## 11. ERROR HANDLING

### 11.1 Recording Errors
```javascript
// Handle MediaMTX recording failures
class RecordingError extends Error {
    constructor(message, cameraId, originalError) {
        super(message);
        this.name = 'RecordingError';
        this.cameraId = cameraId;
        this.originalError = originalError;
    }
}

// Error recovery strategies
async function handleRecordingError(cameraId, error) {
    console.error(`[Recording] Error for camera ${cameraId}:`, error);
    
    // Update recording status to error
    execute(
        'UPDATE recordings SET status = ? WHERE camera_id = ? AND status = ?',
        ['error', cameraId, 'recording']
    );
    
    // Update camera status
    execute('UPDATE cameras SET is_recording = 0 WHERE id = ?', [cameraId]);
    
    // Retry after delay (exponential backoff)
    const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 60000);
    setTimeout(() => {
        startRecording(cameraId);
    }, retryDelay);
}
```

### 11.2 Playback Errors
```javascript
// Frontend error handling
const [error, setError] = useState(null);

const handleVideoError = (e) => {
    const video = e.target;
    let errorMessage = 'Failed to load video';
    
    switch (video.error?.code) {
        case 1: // MEDIA_ERR_ABORTED
            errorMessage = 'Video loading aborted';
            break;
        case 2: // MEDIA_ERR_NETWORK
            errorMessage = 'Network error while loading video';
            break;
        case 3: // MEDIA_ERR_DECODE
            errorMessage = 'Video decoding failed';
            break;
        case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
            errorMessage = 'Video format not supported';
            break;
    }
    
    setError(errorMessage);
};

<video
    ref={videoRef}
    onError={handleVideoError}
/>
```


## 12. MONITORING & LOGGING

### 12.1 Recording Monitoring
```javascript
// Monitor recording health
async function monitorRecordingHealth() {
    const activeRecordings = query(
        'SELECT r.id, r.camera_id, c.name, r.start_time FROM recordings r JOIN cameras c ON r.camera_id = c.id WHERE r.status = ?',
        ['recording']
    );
    
    for (const recording of activeRecordings) {
        const startTime = new Date(recording.start_time);
        const hoursSinceStart = (Date.now() - startTime.getTime()) / (1000 * 60 * 60);
        
        // Alert if recording running > 2 hours without new segment
        if (hoursSinceStart > 2) {
            console.warn(`[Recording] Camera ${recording.camera_id} recording may be stuck`);
            // Send alert via Telegram
            await telegramService.sendAlert(
                `⚠️ Recording Alert\nCamera: ${recording.name}\nRecording stuck for ${hoursSinceStart.toFixed(1)} hours`
            );
        }
    }
}

// Run every 30 minutes
setInterval(monitorRecordingHealth, 30 * 60 * 1000);
```

### 12.2 Audit Logging untuk Recording Actions
```javascript
// Log recording start
logAdminAction({
    action: 'recording_started',
    camera_id: cameraId,
    camera_name: camera.name,
    userId: request.user.id
}, request);

// Log recording stop
logAdminAction({
    action: 'recording_stopped',
    camera_id: cameraId,
    duration_seconds: durationSeconds,
    userId: request.user.id
}, request);

// Log playback access
logAdminAction({
    action: 'recording_played',
    recording_id: recordingId,
    camera_id: recording.camera_id,
    userId: request.user.id
}, request);

// Log recording download
logAdminAction({
    action: 'recording_downloaded',
    recording_id: recordingId,
    camera_id: recording.camera_id,
    userId: request.user.id
}, request);
```


## 13. DEPLOYMENT CHECKLIST

### 13.1 Database Migration
```bash
# Run migration to add recording fields
cd /var/www/rafnet-cctv/backend
node database/migrations/add_recording_fields.js
node database/migrations/create_recordings_table.js
```

### 13.2 Directory Setup
```bash
# Create recordings directory
mkdir -p /var/www/rafnet-cctv/recordings
chown -R root:root /var/www/rafnet-cctv/recordings
chmod 755 /var/www/rafnet-cctv/recordings
```

### 13.3 MediaMTX Configuration
```yaml
# Verify MediaMTX config supports recording
# mediamtx/mediamtx.yml should have:
record: yes
recordPath: /var/www/rafnet-cctv/recordings/%path/%Y-%m-%d_%H-%M-%S
recordFormat: mp4
recordSegmentDuration: 1h
```

### 13.4 Backend Deployment
```bash
# Pull latest code
cd /var/www/rafnet-cctv
git pull origin main

# Install dependencies (if any new)
cd backend
npm install --production

# Restart backend
pm2 restart rafnet-cctv-backend

# Verify recording service started
pm2 logs rafnet-cctv-backend | grep Recording
```

### 13.5 Frontend Deployment
```bash
# Build frontend with playback page
cd /var/www/rafnet-cctv/frontend
npm run build

# Nginx will serve new build automatically
```


## 14. TESTING STRATEGY

### 14.1 Recording Tests
```javascript
// Test recording start
async function testRecordingStart() {
    const camera = queryOne('SELECT id FROM cameras WHERE enabled = 1 LIMIT 1');
    const result = await recordingService.startRecording(camera.id);
    
    console.assert(result.success, 'Recording should start successfully');
    console.assert(recordingService.activeRecordings.has(camera.id), 'Camera should be in active recordings');
    
    // Verify database entry
    const recording = queryOne('SELECT * FROM recordings WHERE camera_id = ? AND status = ?', [camera.id, 'recording']);
    console.assert(recording !== null, 'Recording entry should exist in database');
}

// Test recording stop
async function testRecordingStop() {
    const camera = queryOne('SELECT id FROM cameras WHERE is_recording = 1 LIMIT 1');
    const result = await recordingService.stopRecording(camera.id);
    
    console.assert(result.success, 'Recording should stop successfully');
    console.assert(!recordingService.activeRecordings.has(camera.id), 'Camera should not be in active recordings');
    
    // Verify database updated
    const recording = queryOne('SELECT * FROM recordings WHERE camera_id = ? ORDER BY id DESC LIMIT 1', [camera.id]);
    console.assert(recording.status === 'completed', 'Recording status should be completed');
    console.assert(recording.end_time !== null, 'Recording should have end_time');
}

// Test cleanup
async function testCleanup() {
    // Create old recording entry
    const oldDate = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10 hours ago
    execute('INSERT INTO recordings (camera_id, start_time, status) VALUES (?, ?, ?)', [1, oldDate.toISOString(), 'completed']);
    
    await recordingService.cleanupOldRecordings();
    
    // Verify old recording deleted
    const oldRecording = queryOne('SELECT * FROM recordings WHERE start_time < ? AND status = ?', [oldDate.toISOString(), 'deleted']);
    console.assert(oldRecording !== null, 'Old recording should be marked as deleted');
}
```


### 14.2 Playback Tests
```javascript
// Test playback API
async function testPlaybackAPI() {
    // Test get cameras with recordings
    const camerasResponse = await fetch('/api/playback/cameras', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const cameras = await camerasResponse.json();
    console.assert(cameras.success, 'Should get cameras successfully');
    
    // Test get recordings by date
    const date = new Date().toISOString().split('T')[0];
    const recordingsResponse = await fetch(`/api/playback/recordings/${cameras.data[0].id}?date=${date}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const recordings = await recordingsResponse.json();
    console.assert(recordings.success, 'Should get recordings successfully');
    
    // Test stream recording
    if (recordings.data.length > 0) {
        const streamResponse = await fetch(`/api/playback/stream/${recordings.data[0].id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.assert(streamResponse.ok, 'Should stream recording successfully');
        console.assert(streamResponse.headers.get('content-type') === 'video/mp4', 'Should return MP4 video');
    }
}

// Test range requests
async function testRangeRequests() {
    const recordingId = 1;
    const response = await fetch(`/api/playback/stream/${recordingId}`, {
        headers: { 
            'Authorization': `Bearer ${token}`,
            'Range': 'bytes=0-1023'
        }
    });
    
    console.assert(response.status === 206, 'Should return 206 Partial Content');
    console.assert(response.headers.get('content-range'), 'Should have Content-Range header');
    console.assert(response.headers.get('accept-ranges') === 'bytes', 'Should accept range requests');
}
```


## 15. TROUBLESHOOTING

### 15.1 Common Issues

#### Recording Not Starting
**Symptoms:** Camera `enable_recording = 1` tapi `is_recording = 0`

**Diagnosis:**
```bash
# Check MediaMTX logs
pm2 logs rafnet-cctv-mediamtx | grep -i record

# Check backend logs
pm2 logs rafnet-cctv-backend | grep Recording

# Check camera path exists in MediaMTX
curl http://localhost:9997/v3/config/paths/get/{stream_key}
```

**Solutions:**
1. Verify MediaMTX recording enabled di config
2. Check recordings directory permissions
3. Verify camera stream is active
4. Restart recording service

#### Recording Files Not Found
**Symptoms:** Database has recording entry tapi file tidak ada

**Diagnosis:**
```bash
# Check recordings directory
ls -la /var/www/rafnet-cctv/recordings/camera*/

# Check disk space
df -h /var/www/rafnet-cctv/recordings

# Check file permissions
ls -la /var/www/rafnet-cctv/recordings/
```

**Solutions:**
1. Verify recordings directory exists dan writable
2. Check disk space available
3. Verify MediaMTX has write permissions
4. Check MediaMTX recordPath configuration

#### Playback Video Not Loading
**Symptoms:** Video player shows error atau infinite loading

**Diagnosis:**
```bash
# Test stream endpoint directly
curl -I http://localhost:3000/api/playback/stream/{recordingId}

# Check file exists
ls -la /var/www/rafnet-cctv/recordings/camera*/*.mp4

# Check Nginx logs
tail -f /var/log/nginx/rafnet-cctv-backend.error.log
```

**Solutions:**
1. Verify JWT token valid
2. Check file path in database matches actual file
3. Verify Nginx proxy configuration
4. Check browser console for CORS errors


### 15.2 Debug Commands
```bash
# Check active recordings
sqlite3 /var/www/rafnet-cctv/backend/data/cctv.db "SELECT c.name, r.start_time, r.status FROM recordings r JOIN cameras c ON r.camera_id = c.id WHERE r.status = 'recording'"

# Check storage usage
du -sh /var/www/rafnet-cctv/recordings/*

# List recent recordings
find /var/www/rafnet-cctv/recordings -name "*.mp4" -mtime -1 -ls

# Check MediaMTX recording status
curl http://localhost:9997/v3/config/paths/list | jq '.items[] | select(.record == true)'

# Monitor recording in real-time
watch -n 5 'ls -lh /var/www/rafnet-cctv/recordings/camera1/ | tail -5'
```

## 16. FUTURE ENHANCEMENTS

### 16.1 Potential Features
- **Cloud Storage**: Upload recordings ke S3/Cloud Storage
- **Motion Detection**: Record only saat ada motion
- **Smart Retention**: Keep important recordings longer
- **Multi-Quality**: Record multiple quality levels
- **Live Clipping**: Create clips dari live stream
- **Thumbnail Generation**: Generate thumbnails untuk quick preview
- **Search**: Search recordings by date/time/camera
- **Export**: Export multiple recordings as single file
- **Sharing**: Share recordings via secure links

### 16.2 Performance Improvements
- **Parallel Recording**: Record multiple cameras simultaneously
- **Compression**: Post-process recordings untuk reduce size
- **CDN Integration**: Serve recordings via CDN
- **Adaptive Bitrate**: Record adaptive bitrate streams
- **GPU Acceleration**: Use GPU untuk encoding/transcoding


## 17. SUMMARY & IMPLEMENTATION ROADMAP

### 17.1 Implementation Phases

**Phase 1: Database & Backend Core (2-3 days)**
- [ ] Create database migration untuk recording fields
- [ ] Create recordings table
- [ ] Implement recordingService.js
- [ ] Add recording routes
- [ ] Test recording start/stop

**Phase 2: MediaMTX Integration (1-2 days)**
- [ ] Configure MediaMTX recording
- [ ] Test MediaMTX recording API
- [ ] Implement auto-start recording logic
- [ ] Test recording file generation

**Phase 3: Playback Backend (2-3 days)**
- [ ] Implement playbackController.js
- [ ] Add playback routes
- [ ] Implement file streaming dengan range support
- [ ] Test playback API endpoints

**Phase 4: Frontend Playback UI (3-4 days)**
- [ ] Create Playback page component
- [ ] Implement video player dengan custom controls
- [ ] Add camera/date selector
- [ ] Add recording list
- [ ] Test playback functionality

**Phase 5: Admin Management (1-2 days)**
- [ ] Add recording controls di Camera Management
- [ ] Add recording stats di Dashboard
- [ ] Test admin recording management

**Phase 6: Cleanup & Monitoring (1-2 days)**
- [ ] Implement cleanup scheduler
- [ ] Add recording health monitoring
- [ ] Add audit logging
- [ ] Test cleanup functionality

**Phase 7: Testing & Deployment (2-3 days)**
- [ ] Integration testing
- [ ] Performance testing
- [ ] Security testing
- [ ] Production deployment
- [ ] Documentation

**Total Estimated Time: 12-19 days**


### 17.2 Key Takeaways

**Recording System:**
- MediaMTX handles actual recording (no custom FFmpeg needed)
- 1-hour segments untuk balance file size dan manageability
- Auto-start recording saat camera enabled dengan `enable_recording = 1`
- Auto-cleanup based on retention period per camera
- Recording status tracked di database dan activeRecordings Map

**Playback System:**
- Native HTML5 video player (no HLS.js needed untuk playback)
- HTTP range requests untuk seeking support
- Admin-only access dengan JWT authentication
- Audit logging untuk semua playback access
- Download support untuk recordings

**Storage Management:**
- Local filesystem storage
- Per-camera retention periods
- Automatic cleanup scheduler
- Storage monitoring dan alerts
- Estimated 2 Mbps × hours × cameras storage requirement

**Security:**
- JWT authentication required
- File path validation (prevent directory traversal)
- Audit logging untuk all recording actions
- Rate limiting untuk playback endpoints
- Recording ownership validation

**Performance:**
- No transcoding (copy stream codec)
- Streaming chunks (not full file load)
- Database indexes untuk fast queries
- Browser caching untuk video segments
- Progressive download support

---

**Document Version:** 1.0  
**Last Updated:** 2024-02-01  
**Status:** Complete Analysis - Ready for Implementation
