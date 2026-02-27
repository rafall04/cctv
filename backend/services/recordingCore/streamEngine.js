import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';



const RECORDINGS_BASE_PATH = process.env.RECORDINGS_PATH || '/var/www/rafnet-cctv/recordings';

class StreamEngine {
    constructor({ query, queryOne }) {
        this.activeRecordings = new Map();
        this.restartAttempts = new Map(); // Track restart attempts per camera
        this.isShuttingDown = false;
        this.query = query;
        this.queryOne = queryOne;
    }
    async shutdownAll() {
        this.isShuttingDown = true;
        console.log('[StreamEngine] Engaging Global Shutdown, Disabling Auto-Heal...');
        for (const [cameraId] of this.activeRecordings) {
            await this.stopRecording(cameraId);
        }
    }

    async autoStartRecordings() {
        console.log('[StreamEngine] Auto-starting cameras...');
        try {
            const cameras = this.query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');
            for (let i = 0; i < cameras.length; i++) {
                setTimeout(() => this.startRecording(cameras[i].id), i * 300);
            }
        } catch (error) {
            console.error('[StreamEngine] Error autoStartRecordings:', error);
        }
    }

    async startRecording(cameraId) {
        if (this.activeRecordings.has(cameraId)) return;

        const camera = this.queryOne('SELECT id, private_rtsp_url FROM cameras WHERE id = ?', [cameraId]);
        if (!camera || !camera.private_rtsp_url) return;

        const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
        try {
            await fsp.access(cameraDir);
        } catch {
            await fsp.mkdir(cameraDir, { recursive: true });
        }
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

        const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        this.activeRecordings.set(cameraId, { 
            process: ffmpeg, 
            autoRestart: true, 
            lastFile: null, 
            lastSize: 0, 
            startTime: new Date() 
        });
        
        // Reset restart attempts on successful start if the camera runs for > 15s
        setTimeout(() => {
            if (this.activeRecordings.has(cameraId)) {
                const current = this.activeRecordings.get(cameraId);
                if (current.process === ffmpeg) {
                    this.restartAttempts.set(cameraId, 0);
                    console.log(`[StreamEngine] Camera ${cameraId} stable, resetting restart attempts.`);
                }
            }
        }, 15000);

        console.log(`[StreamEngine] Camera ${cameraId} Started (Wall-Clock Sync Enabled)`);

        console.log(`[StreamEngine] Camera ${cameraId} Started (Wall-Clock Sync Enabled)`);
        ffmpeg.on('close', (code) => {
            const state = this.activeRecordings.get(cameraId);
            this.activeRecordings.delete(cameraId);
            const isExpected = this.isShuttingDown || code === 255 || code === 0 || code === null;
            if (isExpected) {
                console.log(`[StreamEngine] Camera ${cameraId} closed normally or via restart (Code: ${code})`);
            } else {
                console.error(`[StreamEngine] Camera ${cameraId} Crashed! (Code: ${code})`);
            }
            
            if (state && state.autoRestart && !this.isShuttingDown) {
                const attempts = (this.restartAttempts.get(cameraId) || 0) + 1;
                this.restartAttempts.set(cameraId, attempts);
                
                const baseDelay = attempts <= 2 ? 2000 : 10000;
                const jitter = Math.random() * 500;
                const delay = baseDelay + jitter;
                
                console.log(`[StreamEngine] Restarting Camera ${cameraId} in ${Math.round(delay)}ms (Attempt ${attempts})`);
                setTimeout(() => this.startRecording(cameraId), delay);
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
        console.log(`[StreamEngine] Camera ${cameraId} Stopped Intentionally`);
    }

    async checkStalledStreams() {
        for (const [cameraId, state] of this.activeRecordings.entries()) {
            try {
                const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
                try {
                    await fsp.access(cameraDir);
                } catch {
                    continue;
                }
                const filesRaw = await fsp.readdir(cameraDir);
                const mp4Files = filesRaw.filter(f => f.endsWith('.mp4') && !f.includes('.remux.'));
                
                const files = [];
                for (const f of mp4Files) {
                    const stats = await fsp.stat(path.join(cameraDir, f));
                    files.push({ name: f, time: stats.mtime.getTime() });
                }
                files.sort((a, b) => b.time - a.time);

                if (files.length > 0) {
                    const latest = files[0];
                    const fullPath = path.join(cameraDir, latest.name);
                    const stats = await fsp.stat(fullPath);
                    const currentSize = stats.size;
                    if (state.lastFile === latest.name && state.lastSize === currentSize && currentSize > 0) {
                        console.warn(`[StreamEngine Watchdog] Camera ${cameraId} frozen! Executing SIGKILL...`);
                        try { state.process.kill('SIGKILL'); } catch(e){}
                    }
                    state.lastFile = latest.name;
                    state.lastSize = currentSize;
                }
            } catch (e) {}
        }
    }

    getRecordingStatus(cameraId) {
        const recording = this.activeRecordings.get(cameraId);
        const attempts = this.restartAttempts.get(cameraId) || 0;
        if (!recording) return { isRecording: false, status: 'stopped', restartCount: attempts };
        return {
            isRecording: true,
            status: 'recording',
            startTime: recording.startTime,
            duration: Math.floor((Date.now() - recording.startTime.getTime()) / 1000),
            restartCount: attempts
        };
    }

    getStorageUsage(cameraId) {
        try {
            const result = this.queryOne(
                'SELECT SUM(file_size) as total_size, COUNT(*) as segment_count FROM recording_segments WHERE camera_id = ?',
                [cameraId]
            );
            return {
                totalSize: result ? (result.total_size || 0) : 0,
                segmentCount: result ? (result.segment_count || 0) : 0,
                totalSizeGB: result ? ((result.total_size || 0) / 1024 / 1024 / 1024).toFixed(2) : '0.00'
            };
        } catch (error) {
            return { totalSize: 0, segmentCount: 0, totalSizeGB: '0.00' };
        }
    }
}

export { StreamEngine };
