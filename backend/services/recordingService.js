import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execute, query, queryOne } from '../database/connectionPool.js';

const RECORDINGS_BASE_PATH = process.env.RECORDINGS_PATH || '/var/www/rafnet-cctv/recordings';
if (!fs.existsSync(RECORDINGS_BASE_PATH)) {
    fs.mkdirSync(RECORDINGS_BASE_PATH, { recursive: true });
}

class RecordingService {
    constructor() {
        this.activeRecordings = new Map();
        this.fileDebounceTimers = new Map();
        this.dbQueue = [];
        this.isProcessingQueue = false;
        
        setTimeout(() => this.recoverOrphanedSegments(), 5000);
        this.startGlobalWatcher();
        setInterval(() => this.checkStalledStreams(), 60000);
        setInterval(() => this.cleanupOldSegments(), 1800000);
    }

    async autoStartRecordings() {
        console.log('[RecordingService] V4 Pilar 1: Auto-starting cameras...');
        try {
            const cameras = query('SELECT id FROM cameras WHERE is_active = 1 OR status = "online"');
            for (let i = 0; i < cameras.length; i++) {
                setTimeout(() => this.startRecording(cameras[i].id), i * 300);
            }
        } catch (error) {
            console.error('[RecordingService] Error autoStartRecordings:', error);
        }
    }

    async startRecording(cameraId) {
        if (this.activeRecordings.has(cameraId)) return;

        const camera = queryOne('SELECT id, private_rtsp_url FROM cameras WHERE id = ?', [cameraId]);
        if (!camera || !camera.private_rtsp_url) return;

        const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
        if (!fs.existsSync(cameraDir)) fs.mkdirSync(cameraDir, { recursive: true });

        // V4: No +faststart here. Wall-clock sync enforced.
        const args = [
            '-rtsp_transport', 'tcp',
            '-i', camera.private_rtsp_url,
            '-c:v', 'copy',
            '-an',
            '-f', 'segment',
            '-segment_time', '600',
            '-segment_atclocktime', '1',
            '-segment_clocktime_offset', '0',
            '-reset_timestamps', '1',
            '-segment_format', 'mp4',
            '-strftime', '1',
            path.join(cameraDir, '%Y%m%d_%H%M%S.mp4')
        ];

        const ffmpeg = spawn('ffmpeg', args, { stdio: 'ignore' });
        this.activeRecordings.set(cameraId, { process: ffmpeg, autoRestart: true, lastFile: null, lastSize: 0 });
        console.log(`[Pilar 1: Engine] Camera ${cameraId} Started (Wall-Clock Sync Enabled)`);

        ffmpeg.on('close', (code) => {
            const state = this.activeRecordings.get(cameraId);
            this.activeRecordings.delete(cameraId);
            console.warn(`[Pilar 1: Engine] Camera ${cameraId} Exited (Code: ${code})`);
            
            if (state && state.autoRestart) {
                setTimeout(() => this.startRecording(cameraId), 5000);
            }
        });
    }

    async stopRecording(cameraId) {
        const state = this.activeRecordings.get(cameraId);
        if (!state) return;
        state.autoRestart = false;
        try {
            state.process.kill('SIGTERM');
            const killTimer = setTimeout(() => { try { state.process.kill('SIGKILL'); } catch(e){} }, 3000);
            state.process.on('close', () => clearTimeout(killTimer));
        } catch (error) {}
        console.log(`[Pilar 1: Engine] Camera ${cameraId} Stopped Intentionally`);
    }

    checkStalledStreams() {
        for (const [cameraId, state] of this.activeRecordings.entries()) {
            try {
                const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
                if (!fs.existsSync(cameraDir)) continue;
                const files = fs.readdirSync(cameraDir)
                    .filter(f => f.endsWith('.mp4') && !f.includes('.remux.'))
                    .map(f => ({ name: f, time: fs.statSync(path.join(cameraDir, f)).mtime.getTime() }))
                    .sort((a, b) => b.time - a.time);

                if (files.length > 0) {
                    const latest = files[0];
                    const fullPath = path.join(cameraDir, latest.name);
                    const currentSize = fs.statSync(fullPath).size;
                    if (state.lastFile === latest.name && state.lastSize === currentSize && currentSize > 0) {
                        console.warn(`[Watchdog] Camera ${cameraId} frozen! Executing SIGKILL...`);
                        try { state.process.kill('SIGKILL'); } catch(e){}
                    }
                    state.lastFile = latest.name;
                    state.lastSize = currentSize;
                }
            } catch (e) {}
        }
    }

    startGlobalWatcher() {
        try {
            fs.watch(RECORDINGS_BASE_PATH, { recursive: true }, (eventType, filename) => {
                if (!filename || !filename.endsWith('.mp4') || filename.includes('.remux.')) return;
                const filePath = path.join(RECORDINGS_BASE_PATH, filename);
                const fileKey = filename;
                if (this.fileDebounceTimers.has(fileKey)) clearTimeout(this.fileDebounceTimers.get(fileKey));
                
                const timer = setTimeout(() => {
                    this.fileDebounceTimers.delete(fileKey);
                    this.enqueueSegment(filePath, filename);
                }, 10000);
                this.fileDebounceTimers.set(fileKey, timer);
            });
            console.log('[Pilar 2: Watcher] OS Native Event Listener Active');
        } catch (error) {}
    }

    enqueueSegment(filePath, filename) {
        if (!fs.existsSync(filePath)) return;
        this.dbQueue.push({ filePath, filename });
        if (!this.isProcessingQueue) this.processQueue();
    }

    async processQueue() {
        this.isProcessingQueue = true;

        while (this.dbQueue.length > 0) {
            const task = this.dbQueue.shift();
            try {
                if (!fs.existsSync(task.filePath)) continue;

                const parts = task.filename.split(path.sep);
                const camFolder = parts.length > 1 ? parts[parts.length - 2] : null;
                const fileOnly = parts[parts.length - 1];
                
                if (!camFolder || !camFolder.startsWith('camera')) continue;
                const cameraId = parseInt(camFolder.replace('camera', ''), 10);
                
                const regex = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/;
                const match = fileOnly.match(regex);
                if (!match) continue;

                const existing = queryOne('SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?', [cameraId, fileOnly]);
                if (existing) continue;

                let durationStr = '0';
                try {
                    durationStr = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', task.filePath], { encoding: 'utf8', timeout: 5000 }).trim();
                } catch(e) {}

                const rawDuration = parseFloat(durationStr);
                if (isNaN(rawDuration) || rawDuration < 5) {
                    console.warn(`[Pilar 3: Queue] File corrupt or < 5s duration. Deleting: ${fileOnly}`);
                    try { fs.unlinkSync(task.filePath); } catch(e){}
                    continue;
                }

                const tempPath = task.filePath + '.remux.mp4';
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                
                let remuxSuccess = false;
                try {
                    await new Promise((resolve, reject) => {
                        const remuxer = spawn('ffmpeg', [
                            '-i', task.filePath,
                            '-c', 'copy',
                            '-movflags', '+faststart',
                            '-y', tempPath
                        ]);
                        remuxer.on('close', (code) => code === 0 ? resolve() : reject(new Error('code '+code)));
                        remuxer.on('error', reject);
                    });
                    remuxSuccess = true;
                } catch(e) {}

                if (remuxSuccess && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 1024) {
                    fs.renameSync(tempPath, task.filePath);
                } else if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }

                const finalSize = fs.statSync(task.filePath).size;
                const actualDuration = Math.round(rawDuration);

                const [, year, month, day, hour, minute, second] = match;
                const startTimeStr = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
                const startDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
                
                const endDate = new Date(startDate.getTime() + actualDuration * 1000 - (startDate.getTimezoneOffset() * 60000));
                const endTimeStr = endDate.toISOString().replace('T', ' ').substring(0, 19);

                execute(
                    `INSERT INTO recording_segments (camera_id, filename, start_time, end_time, file_size, duration, file_path) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [cameraId, fileOnly, startTimeStr, endTimeStr, finalSize, actualDuration, task.filePath]
                );

                console.log(`[Pilar 3: Queue] ✓ Published ${fileOnly} (${(finalSize/1024/1024).toFixed(2)} MB, ${actualDuration}s)`);
                this.realTimeCleanup();
            } catch (error) {}
        }
        this.isProcessingQueue = false;
    }

    recoverOrphanedSegments() {
        console.log(`[Pilar 4: HouseKeeper] Sweeping for orphaned segments...`);
        try {
            const cameras = query('SELECT id FROM cameras');
            let recovered = 0;
            cameras.forEach(cam => {
                const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cam.id}`);
                if (!fs.existsSync(cameraDir)) return;

                const files = fs.readdirSync(cameraDir).filter(f => f.endsWith('.mp4') && !f.includes('.remux.'));
                files.forEach(file => {
                    const fullPath = path.join(cameraDir, file);
                    const stats = fs.statSync(fullPath);
                    if (Date.now() - stats.mtime.getTime() > 300000) {
                        const existing = queryOne('SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?', [cam.id, file]);
                        if (!existing) {
                            this.enqueueSegment(fullPath, path.join(`camera${cam.id}`, file));
                            recovered++;
                        }
                    }
                });
            });
            if (recovered > 0) console.log(`[Pilar 4: HouseKeeper] Sent ${recovered} orphans to Queue.`);
        } catch (e) {}
    }

    realTimeCleanup() {
        try {
            const settings = queryOne('SELECT recording_duration_hours FROM settings LIMIT 1');
            const hours = settings ? settings.recording_duration_hours : 168;
            
            const thresholdDate = new Date(Date.now() - hours * 3600000);
            const thresholdStr = thresholdDate.toISOString().replace('T', ' ').substring(0, 19);

            const oldSegments = query('SELECT id, file_path FROM recording_segments WHERE end_time < ? LIMIT 10', [thresholdStr]);
            
            for (const seg of oldSegments) {
                if (fs.existsSync(seg.file_path)) try { fs.unlinkSync(seg.file_path); } catch(e){}
                execute('DELETE FROM recording_segments WHERE id = ?', [seg.id]);
            }

            if (os.platform() === 'linux') {
                const df = execFileSync('df', ['-k', RECORDINGS_BASE_PATH], { encoding: 'utf8' }).split('\n')[1].split(/\s+/);
                const freeKB = parseInt(df[3], 10);
                if (freeKB < 2000000) {
                    console.warn('[Pilar 4: HouseKeeper] 🚨 EMERGENCY DISK LOW! Evicting oldest files...');
                    const oldest = query('SELECT id, file_path FROM recording_segments ORDER BY start_time ASC LIMIT 5');
                    for (const seg of oldest) {
                        if (fs.existsSync(seg.file_path)) try { fs.unlinkSync(seg.file_path); } catch(e){}
                        execute('DELETE FROM recording_segments WHERE id = ?', [seg.id]);
                    }
                }
            }
        } catch (error) {}
    }

    cleanupOldSegments() {
        this.realTimeCleanup();
    }
}

export const recordingService = new RecordingService();