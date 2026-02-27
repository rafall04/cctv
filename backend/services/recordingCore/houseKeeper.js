import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import util from 'util';
import { lockManager } from './lockManager.js';
import { execute, query, queryOne } from '../../database/connectionPool.js';

const execFileAsync = util.promisify(execFile);

const RECORDINGS_BASE_PATH = process.env.RECORDINGS_PATH || '/var/www/rafnet-cctv/recordings';

async function existsAsync(filePath) {
    try {
        await fsp.access(filePath);
        return true;
    } catch {
        return false;
    }
}


class HouseKeeper {
    async recoverOrphanedSegments(enqueueCallback) {
        console.log(`[HouseKeeper] Sweeping for orphaned segments...`);
        try {
            const cameras = query('SELECT id FROM cameras');
            let recovered = 0;
            
            for (const cam of cameras) {
                const cameraDir = path.join(RECORDINGS_BASE_PATH, `camera${cam.id}`);
                if (!(await existsAsync(cameraDir))) continue;

                const files = await fsp.readdir(cameraDir);
                const mp4Files = files.filter(f => f.endsWith('.mp4') && !f.includes('.remux.'));
                
                for (const file of mp4Files) {
                    const fullPath = path.join(cameraDir, file);
                    if (lockManager.isLocked(fullPath)) continue;

                    const stats = await fsp.stat(fullPath);
                    if (Date.now() - stats.mtime.getTime() > 300000) {
                        const existing = queryOne('SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?', [cam.id, file]);
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
            const settings = queryOne('SELECT recording_duration_hours FROM settings LIMIT 1');
            const hours = settings ? settings.recording_duration_hours : 168;
            
            const thresholdDate = new Date(Date.now() - hours * 3600000);
            const thresholdStr = thresholdDate.toISOString().replace('T', ' ').substring(0, 19);

            const oldSegments = query('SELECT id, file_path FROM recording_segments WHERE end_time < ? LIMIT 10', [thresholdStr]);
            
            for (const seg of oldSegments) {
                if (lockManager.isLocked(seg.file_path)) continue;
                if (await existsAsync(seg.file_path)) {
                    try { await fsp.unlink(seg.file_path); } catch(e){}
                }
                execute('DELETE FROM recording_segments WHERE id = ?', [seg.id]);
            }

            if (os.platform() === 'linux') {
                try {
                    const { stdout } = await execFileAsync('df', ['-k', RECORDINGS_BASE_PATH], { encoding: 'utf8' });
                    const df = stdout.split('\n')[1].split(/\s+/);
                    const freeKB = parseInt(df[3], 10);
                    if (freeKB < 2000000) {
                        console.warn('[HouseKeeper] 🚨 EMERGENCY DISK LOW! Evicting oldest files...');
                        const oldest = query('SELECT id, file_path FROM recording_segments ORDER BY start_time ASC LIMIT 5');
                        for (const seg of oldest) {
                            if (lockManager.isLocked(seg.file_path)) continue;
                            if (await existsAsync(seg.file_path)) {
                                try { await fsp.unlink(seg.file_path); } catch(e){}
                            }
                            execute('DELETE FROM recording_segments WHERE id = ?', [seg.id]);
                        }
                    }
                } catch (dfErr) {}
            }
        } catch (error) {
            console.error('[HouseKeeper] Error in realTimeCleanup:', error);
        }
}

export const houseKeeper = new HouseKeeper();
