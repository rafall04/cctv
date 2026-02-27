import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { execute, queryOne } from '../database/connectionPool.js';

class SegmentProcessor {
    constructor() {
        this.dbQueue = [];
        this.isProcessingQueue = false;
    }

    enqueueSegment(filePath, filename) {
        if (!fs.existsSync(filePath)) return;
        this.dbQueue.push({ filePath, filename });
        if (!this.isProcessingQueue) this.processQueue();
    }

    async processQueue() {
        if (this.isProcessingQueue) return;
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
                    console.warn(`[SegmentProcessor] File corrupt or < 5s duration. Deleting: ${fileOnly}`);
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

                console.log(`[SegmentProcessor] ✓ Published ${fileOnly} (${(finalSize/1024/1024).toFixed(2)} MB, ${actualDuration}s)`);
                
                // Emit event or call global houseKeeper if needed? 
                // Original logic called this.realTimeCleanup() here.
                // We will handle this in the unified index or by injecting houseKeeper.
                if (this.onSegmentProcessed) this.onSegmentProcessed();
                
            } catch (error) {
                console.error('[SegmentProcessor] Error processing task:', error);
            }
        }
        this.isProcessingQueue = false;
    }
}

export const segmentProcessor = new SegmentProcessor();
