import { spawn, execFile } from 'child_process';
import util from 'util';
import { promises as fsp } from 'fs';
import fs from 'fs';
import path from 'path';


const execFileAsync = util.promisify(execFile);

async function existsAsync(filePath) {
    try {
        await fsp.access(filePath);
        return true;
    } catch {
        return false;
    }
}


class SegmentProcessor {
    constructor({ execute, queryOne, lockManager }) {
        this.execute = execute;
        this.queryOne = queryOne;
        this.lockManager = lockManager;
        this.dbQueue = [];
        this.isProcessingQueue = false;
    }

    async enqueueSegment(filePath, filename) {
        if (!(await existsAsync(filePath))) return;
        this.dbQueue.push({ filePath, filename });
        if (!this.isProcessingQueue) this.processQueue();
    }

    async processQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.dbQueue.length > 0) {
            const task = this.dbQueue.shift();
            try {
                if (!(await existsAsync(task.filePath))) continue;

                const parts = task.filename.split(path.sep);
                const camFolder = parts.length > 1 ? parts[parts.length - 2] : null;
                const fileOnly = parts[parts.length - 1];
                
                if (!camFolder || !camFolder.startsWith('camera')) continue;
                const cameraId = parseInt(camFolder.replace('camera', ''), 10);
                
                const regex = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/;
                const match = fileOnly.match(regex);
                if (!match) continue;

                // 1. Check if segment already exists in DB (Idempotency)
                const existing = this.queryOne('SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?', [cameraId, fileOnly]);
                if (existing) {
                    console.log(`[SegmentProcessor] Skipping already processed segment: ${fileOnly}`);
                    continue;
                }

                // 2. Probing: Check duration and integrity
                let durationStr = '0';
                this.lockManager.acquire(task.filePath);
                try {
                    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', task.filePath], { encoding: 'utf8', timeout: 5000 });
                    durationStr = stdout.trim();
                } catch(e) {
                    console.error(`[SegmentProcessor] ffprobe failed for ${fileOnly}:`, e.message);
                } finally {
                    this.lockManager.release(task.filePath);
                }

                const rawDuration = parseFloat(durationStr);
                if (isNaN(rawDuration) || rawDuration < 1) {
                    console.log(`[SegmentProcessor] Cleanup: Skipping tiny/invalid file < 1s. Deleting: ${fileOnly}`);
                    try { await fsp.unlink(task.filePath); } catch(e){}
                    continue;
                }

                // 3. Remuxing: One clean pass with +faststart
                const tempPath = task.filePath + '.remux.mp4';
                if (await existsAsync(tempPath)) {
                    try { await fsp.unlink(tempPath); } catch(e){}
                }
                
                let remuxSuccess = false;
                this.lockManager.acquire(task.filePath);
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
                } catch(e) {
                    console.error(`[SegmentProcessor] Remux failed for ${fileOnly}:`, e.message);
                } finally {
                    this.lockManager.release(task.filePath);
                }

                if (!remuxSuccess || !(await existsAsync(tempPath))) {
                    if (await existsAsync(tempPath)) try { await fsp.unlink(tempPath); } catch(e){}
                    continue; // Skip if remux failed
                }

                // 4. Finalizing: Atomic swap and DB Insert
                const stats = await fsp.stat(tempPath);
                if (stats.size <= 1024) {
                    console.warn(`[SegmentProcessor] Remuxed file too small (${stats.size} bytes), skipping: ${fileOnly}`);
                    await fsp.unlink(tempPath);
                    continue;
                }

                this.lockManager.acquire(task.filePath);
                try {
                    await fsp.rename(tempPath, task.filePath);
                } catch (e) {
                    console.error(`[SegmentProcessor] Finalize rename failed for ${fileOnly}:`, e.message);
                    if (await existsAsync(tempPath)) try { await fsp.unlink(tempPath); } catch(err){}
                    continue;
                } finally {
                    this.lockManager.release(task.filePath);
                }

                const finalStats = await fsp.stat(task.filePath);
                const finalSize = finalStats.size;
                const actualDuration = Math.round(rawDuration);

                const [, year, month, day, hour, minute, second] = match;
                const startTimeStr = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
                const startDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
                const endDate = new Date(startDate.getTime() + actualDuration * 1000 - (startDate.getTimezoneOffset() * 60000));
                const endTimeStr = endDate.toISOString().replace('T', ' ').substring(0, 19);

                // Final check before insert (just in case)
                const duplicateCheck = this.queryOne('SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?', [cameraId, fileOnly]);
                if (duplicateCheck) {
                    console.warn(`[SegmentProcessor] Race condition detected: Segment ${fileOnly} already in DB.`);
                    continue;
                }

                this.execute(
                    `INSERT INTO recording_segments (camera_id, filename, start_time, end_time, file_size, duration, file_path) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [cameraId, fileOnly, startTimeStr, endTimeStr, finalSize, actualDuration, task.filePath]
                );

                console.log(`[SegmentProcessor] ✓ Finalized ${fileOnly} (${(finalSize/1024/1024).toFixed(2)} MB, ${actualDuration}s)`);
                if (this.onSegmentProcessed) this.onSegmentProcessed();
                
            } catch (error) {
                console.error('[SegmentProcessor] Error processing task:', error);
            }
        }
        this.isProcessingQueue = false;
    }
}

export { SegmentProcessor };
