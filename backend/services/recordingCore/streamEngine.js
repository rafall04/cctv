import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { query, queryOne } from '../../database/connectionPool.js';

const RECORDINGS_BASE_PATH = process.env.RECORDINGS_PATH || '/var/www/rafnet-cctv/recordings';

class StreamEngine {
    constructor() {
        this.activeRecordings = new Map();
        this.isShuttingDown = false;
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
            const cameras = query('SELECT id FROM cameras WHERE is_active = 1 OR status = "online"');
            for (let i = 0; i < cameras.length; i++) {
                setTimeout(() => this.startRecording(cameras[i].id), i * 300);
            }
        } catch (error) {
            console.error('[StreamEngine] Error autoStartRecordings:', error);
        }
    }

    async startRecording(cameraId) {
        if (this.activeRecordings.has(cameraId)) return;

        const camera = queryOne('SELECT id, private_rtsp_url FROM cameras WHERE id = ?', [cameraId]);
        if (!camera || !camera.private_rtsp_url) return;

        const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
        if (!fs.existsSync(cameraDir)) fs.mkdirSync(cameraDir, { recursive: true });

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
        console.log(`[StreamEngine] Camera ${cameraId} Started (Wall-Clock Sync Enabled)`);

        ffmpeg.on('close', (code) => {
            const state = this.activeRecordings.get(cameraId);
            this.activeRecordings.delete(cameraId);
            console.warn(`[StreamEngine] Camera ${cameraId} Exited (Code: ${code})`);
            
            if (state && state.autoRestart && !this.isShuttingDown) {
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
        console.log(`[StreamEngine] Camera ${cameraId} Stopped Intentionally`);
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
                        console.warn(`[StreamEngine Watchdog] Camera ${cameraId} frozen! Executing SIGKILL...`);
                        try { state.process.kill('SIGKILL'); } catch(e){}
                    }
                    state.lastFile = latest.name;
                    state.lastSize = currentSize;
                }
            } catch (e) {}
        }
    }
}

export const streamEngine = new StreamEngine();
