import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', 'data', 'cctv.db');

const db = new Database(dbPath);

console.log('================================================================================');
console.log('SYNC MISSING RECORDINGS TO DATABASE');
console.log('================================================================================\n');

// Get all cameras with recording enabled
const cameras = db.prepare('SELECT id, name FROM cameras WHERE enable_recording = 1').all();
console.log(`Found ${cameras.length} cameras with recording enabled\n`);

let totalSynced = 0;
let totalSkipped = 0;

for (const camera of cameras) {
    const recordingsDir = `/var/www/rafnet-cctv/recordings/camera${camera.id}`;
    
    if (!fs.existsSync(recordingsDir)) {
        console.log(`Camera ${camera.id} (${camera.name}): No recordings directory`);
        continue;
    }
    
    // Get files from filesystem
    const files = fs.readdirSync(recordingsDir)
        .filter(f => f.endsWith('.mp4'))
        .map(f => {
            const filepath = path.join(recordingsDir, f);
            const stats = fs.statSync(filepath);
            return {
                filename: f,
                filepath,
                size: stats.size,
                mtime: stats.mtime
            };
        });
    
    if (files.length === 0) {
        console.log(`Camera ${camera.id} (${camera.name}): No MP4 files`);
        continue;
    }
    
    // Get existing recordings from database
    const existingRecordings = db.prepare('SELECT filename FROM recordings WHERE camera_id = ?').all(camera.id);
    const existingFilenames = new Set(existingRecordings.map(r => r.filename));
    
    // Find missing files
    const missingFiles = files.filter(f => !existingFilenames.has(f.filename));
    
    console.log(`Camera ${camera.id} (${camera.name}):`);
    console.log(`  Total files: ${files.length}`);
    console.log(`  In database: ${existingFilenames.size}`);
    console.log(`  Missing: ${missingFiles.length}`);
    
    if (missingFiles.length > 0) {
        const insertStmt = db.prepare(`
            INSERT INTO recordings (camera_id, filename, filepath, start_time, end_time, duration_seconds, file_size_bytes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')
        `);
        
        for (const file of missingFiles) {
            try {
                // Parse filename to get start time: 20260201_161002.mp4 -> 2026-02-01 16:10:02
                const match = file.filename.match(/(\d{8})_(\d{6})\.mp4/);
                if (!match) {
                    console.log(`  ⚠️ Skip ${file.filename}: Invalid filename format`);
                    totalSkipped++;
                    continue;
                }
                
                const dateStr = match[1]; // 20260201
                const timeStr = match[2]; // 161002
                
                const year = dateStr.substring(0, 4);
                const month = dateStr.substring(4, 6);
                const day = dateStr.substring(6, 8);
                const hour = timeStr.substring(0, 2);
                const minute = timeStr.substring(2, 4);
                const second = timeStr.substring(4, 6);
                
                const startTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
                
                // Estimate duration from file size (rough estimate: 2 Mbps = 250 KB/s)
                const durationSeconds = Math.floor(file.size / (250 * 1024));
                
                // Calculate end time
                const startDate = new Date(startTime);
                const endDate = new Date(startDate.getTime() + durationSeconds * 1000);
                const endTime = endDate.toISOString().replace('T', ' ').substring(0, 19);
                
                insertStmt.run(
                    camera.id,
                    file.filename,
                    file.filepath,
                    startTime,
                    endTime,
                    durationSeconds,
                    file.size
                );
                
                console.log(`  ✓ Synced: ${file.filename}`);
                totalSynced++;
            } catch (error) {
                console.log(`  ✗ Error syncing ${file.filename}:`, error.message);
                totalSkipped++;
            }
        }
    }
    
    console.log('');
}

console.log('================================================================================');
console.log('SYNC SUMMARY');
console.log('================================================================================');
console.log(`Total synced: ${totalSynced}`);
console.log(`Total skipped: ${totalSkipped}`);
console.log('================================================================================\n');

db.close();
