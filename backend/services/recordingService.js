import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execute, query, queryOne } from '../database/connectionPool.js';

// Configuration
const RECORDINGS_BASE_PATH = process.env.RECORDINGS_PATH || '/var/www/rafnet-cctv/recordings';
if (!fs.existsSync(RECORDINGS_BASE_PATH)) {
    fs.mkdirSync(RECORDINGS_BASE_PATH, { recursive: true });
}

class RecordingService {
    constructor() {
        this.activeRecordings = new Map(); // cameraId -> { process, autoRestart: boolean }
        this.fileDebounceTimers = new Map(); // fileKey -> timeoutId
        this.dbQueue = [];
        this.isProcessingQueue = false;
        
        // 1. Orphan Sweeper (Run once on startup)
        setTimeout(() => this.recoverOrphanedSegments(), 5000);

        // 2. Global Watcher (Zero CPU file completion detection)
        this.startGlobalWatcher();

        // 3. Stalled Stream Watchdog (Checks for frozen cameras)
        setInterval(() => this.checkStalledStreams(), 60000);

        // 4. Auto Cleanup (Disk space management)
        setInterval(() => this.cleanupOldSegments(), 1800000); // 30 minutes
    }

    startGlobalWatcher() {
        try {
            fs.watch(RECORDINGS_BASE_PATH, { recursive: true }, (eventType, filename) => {
                if (!filename || !filename.endsWith('.mp4')) return;
                
                const filePath = path.join(RECORDINGS_BASE_PATH, filename);
                const fileKey = filename;

                // Reset the 10-second debounce timer every time the file is modified
                if (this.fileDebounceTimers.has(fileKey)) {
                    clearTimeout(this.fileDebounceTimers.get(fileKey));
                }

                // If FFmpeg hasn't touched the file in 10 seconds, it's considered DONE.
                const timer = setTimeout(() => {
                    this.fileDebounceTimers.delete(fileKey);
                    this.enqueueSegmentForDb(filePath, filename);
                }, 10000);

                this.fileDebounceTimers.set(fileKey, timer);
            });
            console.log('[RecordingService] Global File Watcher Active');
        } catch (error) {
            console.error('[RecordingService] Failed to start fs.watch:', error);
        }
    }

    enqueueSegmentForDb(filePath, filename) {
        if (!fs.existsSync(filePath)) return;
        const stats = fs.statSync(filePath);
        
        if (stats.size < 500 * 1024) {
            console.warn(`[Segment] File < 500KB (corrupt/empty). Deleting: ${filename}`);
            try { fs.unlinkSync(filePath); } catch(e){}
            return;
        }

        // Add to queue and start processing if idle
        this.dbQueue.push({ filePath, filename, size: stats.size });
        if (!this.isProcessingQueue) {
            this.processDbQueue();
        }
    }

    async processDbQueue() {
        this.isProcessingQueue = true;

        while (this.dbQueue.length > 0) {
            const task = this.dbQueue.shift();
            try {
                // Extract Camera ID and time from filename: camera1/20260227_080000.mp4
                const parts = task.filename.split(path.sep);
                const camFolder = parts.length > 1 ? parts[parts.length - 2] : null;
                const fileOnly = parts[parts.length - 1];
                
                if (!camFolder || !camFolder.startsWith('camera')) continue;
                const cameraId = parseInt(camFolder.replace('camera', ''), 10);
                
                const regex = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/;
                const match = fileOnly.match(regex);
                if (!match) continue;

                // Check if already exists to prevent duplicates (SQLITE_BUSY safe due to queue)
                const existing = queryOne('SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?', [cameraId, fileOnly]);
                if (existing) continue;

                // Probe exact duration safely
                let duration = 600;
                try {
                    const probeOut = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', task.filePath], { encoding: 'utf8', timeout: 5000 }).trim();
                    if (probeOut && parseFloat(probeOut) > 0) duration = Math.round(parseFloat(probeOut));
                } catch(e) {}

                // Build local time string
                const [, year, month, day, hour, minute, second] = match;
                const startTimeStr = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
                const startDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
                
                // Calculate local end time
                const endDate = new Date(startDate.getTime() + duration * 1000 - (startDate.getTimezoneOffset() * 60000));
                const endTimeStr = endDate.toISOString().replace('T', ' ').substring(0, 19);

                execute(
                    `INSERT INTO recording_segments (camera_id, filename, start_time, end_time, file_size, duration, file_path) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [cameraId, fileOnly, startTimeStr, endTimeStr, task.size, duration, task.filePath]
                );

                console.log(`[Database Queue] ✓ Inserted ${fileOnly} (${(task.size/1024/1024).toFixed(2)} MB, ${duration}s)`);
            } catch (error) {
                console.error(`[Database Queue] Error processing ${task.filename}:`, error.message);
            }
        }

        this.isProcessingQueue = false;
    }

    async startRecording(cameraId) {
        if (this.activeRecordings.has(cameraId)) return;

        const camera = queryOne('SELECT id, private_rtsp_url FROM cameras WHERE id = ?', [cameraId]);
        if (!camera || !camera.private_rtsp_url) return;

        const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
        if (!fs.existsSync(cameraDir)) fs.mkdirSync(cameraDir, { recursive: true });

        // NATIVE MP4 - NO REMUXING REQUIRED LATER!
        const args = [
            '-rtsp_transport', 'tcp',
            '-i', camera.private_rtsp_url,
            '-c:v', 'copy',
            '-an',
            '-f', 'segment',
            '-segment_time', '600',
            '-reset_timestamps', '1',
            '-segment_format', 'mp4',
            '-movflags', '+faststart',
            '-strftime', '1',
            path.join(cameraDir, '%Y%m%d_%H%M%S.mp4')
        ];

        const ffmpeg = spawn('ffmpeg', args, { stdio: 'ignore' });
        
        this.activeRecordings.set(cameraId, { process: ffmpeg, autoRestart: true, lastFile: null, lastSize: 0 });
        console.log(`[FFmpeg Camera ${cameraId}] Started (Native MP4)`);

        ffmpeg.on('close', (code) => {
            const state = this.activeRecordings.get(cameraId);
            this.activeRecordings.delete(cameraId);
            
            console.warn(`[FFmpeg Camera ${cameraId}] Exited with code ${code}`);
            
            if (state && state.autoRestart) {
                console.log(`[Auto-Heal] Restarting Camera ${cameraId} in 5s...`);
                setTimeout(() => this.startRecording(cameraId), 5000);
            }
        });
    }

    async stopRecording(cameraId) {
        const state = this.activeRecordings.get(cameraId);
        if (!state) return;

        // Prevent auto-restart
        state.autoRestart = false;
        
        try {
            state.process.kill('SIGTERM');
            const killTimer = setTimeout(() => {
                try { state.process.kill('SIGKILL'); } catch(e){}
            }, 3000);
            state.process.on('close', () => clearTimeout(killTimer));
        } catch (error) {}
        
        console.log(`[FFmpeg Camera ${cameraId}] Stopped Intentionally`);
    }

    

    async autoStartRecordings() {
        console.log('[RecordingService] Auto-starting recordings for active cameras...');
        try {
            // Adjust query depending on your schema. We try to be safe.
            const cameras = query('SELECT id FROM cameras');
            
            for (let i = 0; i < cameras.length; i++) {
                const cam = cameras[i];
                // Stagger starts to avoid CPU/Network spikes
                setTimeout(() => {
                    this.startRecording(cam.id);
                }, i * 300); // 300ms between each camera
            }
        } catch (error) {
            console.error('[RecordingService] Error during autoStartRecordings:', error);
        }
    }

    checkStalledStreams() {
        for (const [cameraId, state] of this.activeRecordings.entries()) {
            try {
                const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
                if (!fs.existsSync(cameraDir)) continue;

                // Find the most recently modified mp4
                const files = fs.readdirSync(cameraDir)
                    .filter(f => f.endsWith('.mp4'))
                    .map(f => ({ name: f, time: fs.statSync(path.join(cameraDir, f)).mtime.getTime() }))
                    .sort((a, b) => b.time - a.time);

                if (files.length > 0) {
                    const latest = files[0];
                    const fullPath = path.join(cameraDir, latest.name);
                    const currentSize = fs.statSync(fullPath).size;

                    // If size hasn't changed in 60s, stream is frozen
                    if (state.lastFile === latest.name && state.lastSize === currentSize && currentSize > 0) {
                        console.warn(`[Watchdog] Camera ${cameraId} stream frozen! Killing FFmpeg...`);
                        try { state.process.kill('SIGKILL'); } catch(e){}
                    }

                    state.lastFile = latest.name;
                    state.lastSize = currentSize;
                }
            } catch (e) {}
        }
    }

    recoverOrphanedSegments() {
        console.log(`[Orphan Sweeper] Scanning for unrecorded segments...`);
        try {
            const cameras = query('SELECT id FROM cameras');
            let recovered = 0;
            
            cameras.forEach(cam => {
                const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cam.id}`);
                if (!fs.existsSync(cameraDir)) return;

                const files = fs.readdirSync(cameraDir).filter(f => f.endsWith('.mp4'));
                files.forEach(file => {
                    const fullPath = path.join(cameraDir, file);
                    const stats = fs.statSync(fullPath);
                    
                    // Only process files older than 5 minutes (definitely not active)
                    if (Date.now() - stats.mtime.getTime() > 300000 && stats.size > 500000) {
                        const existing = queryOne('SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?', [cam.id, file]);
                        if (!existing) {
                            this.enqueueSegmentForDb(fullPath, path.join(`camera${cam.id}`, file));
                            recovered++;
                        }
                    }
                });
            });
            if (recovered > 0) console.log(`[Orphan Sweeper] Recovered ${recovered} orphaned segments into DB Queue.`);
        } catch (e) {}
    }

    async cleanupOldSegments() {
        try {
            const settings = queryOne('SELECT recording_duration_hours FROM settings LIMIT 1');
            const hours = settings ? settings.recording_duration_hours : 168; // default 7 days
            
            const thresholdDate = new Date(Date.now() - hours * 3600000);
            const thresholdStr = thresholdDate.toISOString().replace('T', ' ').substring(0, 19);

            const oldSegments = query('SELECT id, file_path FROM recording_segments WHERE end_time < ?', [thresholdStr]);
            
            for (const seg of oldSegments) {
                if (fs.existsSync(seg.file_path)) {
                    try { fs.unlinkSync(seg.file_path); } catch(e){}
                }
                execute('DELETE FROM recording_segments WHERE id = ?', [seg.id]);
            }
            
            if (oldSegments.length > 0) console.log(`[Cleanup] Removed ${oldSegments.length} old segments.`);

            // Emergency Disk Check (< 2GB free)
            if (os.platform() === 'linux') {
                const df = execFileSync('df', ['-k', RECORDINGS_BASE_PATH], { encoding: 'utf8' }).split('\n')[1].split(/\s+/);
                const freeKB = parseInt(df[3], 10);
                if (freeKB < 2000000) { // < 2GB
                    console.warn('[Emergency Cleanup] Disk space critically low! Deleting oldest files...');
                    const oldest = query('SELECT id, file_path FROM recording_segments ORDER BY start_time ASC LIMIT 5');
                    for (const seg of oldest) {
                        if (fs.existsSync(seg.file_path)) try { fs.unlinkSync(seg.file_path); } catch(e){}
                        execute('DELETE FROM recording_segments WHERE id = ?', [seg.id]);
                    }
                }
            }
        } catch (error) {}
    }
    async autoStartRecordings() {
        console.log('[RecordingService] Auto-starting recordings for active cameras...');
        try {
            // Fetch cameras that have recording enabled and are enabled/active
            const cameras = query('SELECT id FROM cameras WHERE enabled = 1 AND enable_recording = 1');
            
            if (cameras.length === 0) {
                console.log('[RecordingService] No cameras found with recording enabled.');
                return;
            }

            console.log(`[RecordingService] Found ${cameras.length} cameras to auto-start.`);

            for (const camera of cameras) {
                // Stagger starts to avoid CPU spikes (200ms delay)
                await new Promise(resolve => setTimeout(resolve, 200));
                this.startRecording(camera.id).catch(err => {
                    console.error(`[RecordingService] Failed to auto-start camera ${camera.id}:`, err.message);
                });
            }
        } catch (error) {
            console.error('[RecordingService] Error during autoStartRecordings:', error.message);
        }
    }

}

export const recordingService = new RecordingService();