import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

import { RECORDINGS_BASE_PATH } from './recordingPaths.js';

async function existsAsync(filePath) {
    try {
        await fsp.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export class HouseKeeper {
    constructor({ execute, query, queryOne, lockManager }) {
        this.execute = execute;
        this.query = query;
        this.queryOne = queryOne;
        this.lockManager = lockManager;
    }

    async recoverOrphanedSegments(enqueueCallback) {
        console.log(`[HouseKeeper] Sweeping for orphaned segments...`);
        try {
            const cameras = this.query('SELECT id FROM cameras');
            let recovered = 0;
            
            for (const cam of cameras) {
                const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cam.id}`);
                if (!(await existsAsync(cameraDir))) continue;

                const files = await fsp.readdir(cameraDir);
                const mp4Files = files.filter(f => f.endsWith('.mp4') && !f.includes('.remux.'));
                
                for (const file of mp4Files) {
                    const fullPath = path.join(cameraDir, file);
                    if (this.lockManager.isLocked(fullPath)) continue;

                    const stats = await fsp.stat(fullPath);
                    if (Date.now() - stats.mtime.getTime() > 300000) {
                        const existing = this.queryOne('SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?', [cam.id, file]);
                        if (!existing) {
                            if (enqueueCallback) {
                                enqueueCallback(fullPath, path.join(`camera${cam.id}`, file));
                                recovered++;
                            }
                        }
                    }
                }
            }
            if (recovered > 0) console.log(`[HouseKeeper] Sent ${recovered} orphans to Queue.`);
        } catch (e) {
            console.error('[HouseKeeper] Error in recoverOrphanedSegments:', e);
        }
    }

    async realTimeCleanup() {
        try {
            // 1. Get all cameras with their recording retention settings
            const cameras = this.query('SELECT id, recording_duration_hours FROM cameras');

            // 2. Disk Emergency Mode Check
            let emergencyMode = false;
            try {
                // Use fs.promises.statfs (available in Node 18+)
                const stats = await fsp.statfs(RECORDINGS_BASE_PATH);
                const freeSpaceGB = (Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024 * 1024);
                if (freeSpaceGB < 10) {
                    emergencyMode = true;
                    console.warn(`[HouseKeeper] 🚨 EMERGENCY DISK LOW! (${freeSpaceGB.toFixed(2)}GB free). Accelerating cleanup.`);
                }
            } catch (err) {
                console.error('[HouseKeeper] Disk space check failed:', err);
            }

            for (const cam of cameras) {
                const hours = cam.recording_duration_hours || 168; // Default 7 days
                const cutoffDate = new Date(Date.now() - hours * 3600000);
                const cutoffStr = cutoffDate.toISOString().replace('T', ' ').substring(0, 19);

                // 3. Query segments to clean up
                // In emergency mode, we ignore the retention hour limit for the oldest files, but still respect grace/locks.
                const queryStr = emergencyMode
                    ? 'SELECT id, file_path FROM recording_segments WHERE camera_id = ? ORDER BY end_time ASC LIMIT 100'
                    : 'SELECT id, file_path FROM recording_segments WHERE camera_id = ? AND end_time <= ? ORDER BY end_time ASC LIMIT 100';
                const queryParams = emergencyMode ? [cam.id] : [cam.id, cutoffStr];

                const oldSegments = this.query(queryStr, queryParams);
                let deleted = 0;
                let skipped = 0;
                let kept = 0;
                const graceThreshold = Date.now() - 90000; // 90 seconds grace period

                for (const seg of oldSegments) {
                    // Skip if locked
                    if (this.lockManager.isLocked(seg.file_path)) {
                        skipped++;
                        continue;
                    }

                    let fileDeleted = false;
                    try {
                        const stats = await fsp.stat(seg.file_path);
                        // Skip if file is too new (grace period)
                        if (stats.mtimeMs > graceThreshold) {
                            kept++;
                            continue;
                        }

                        // Try to delete physical file
                        await fsp.unlink(seg.file_path);
                        fileDeleted = true;
                        deleted++;
                    } catch (e) {
                        // If file is already gone (ENOENT), we should still delete the DB row.
                        // Otherwise, if it's some other error (EPERM, etc), we skip DB deletion to retry later.
                        if (e.code === 'ENOENT') {
                            fileDeleted = true; // Already gone, safe to remove DB row
                            deleted++;
                        } else {
                            console.error(`[HouseKeeper] Failed to unlink ${seg.file_path}:`, e.message);
                            fileDeleted = false;
                        }
                    }

                    // 4. Delete DB row only if physical file is gone (or was already gone)
                    if (fileDeleted) {
                        this.execute('DELETE FROM recording_segments WHERE id = ?', [seg.id]);
                    }
                }
                if (deleted > 0 || skipped > 0 || kept > 0) {
                    console.log(`[HouseKeeper] Cleanup for Cam ${cam.id}: Deleted: ${deleted}, Skipped: ${skipped} (Locked), Kept: ${kept} (Grace)`);
                }
            }
        } catch (error) {
            console.error('[HouseKeeper] Error in realTimeCleanup:', error);
        }
    }
}