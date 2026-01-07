/**
 * Migration: Add stream_key column to cameras table
 * 
 * This adds a unique UUID-based stream key for each camera
 * to make stream URLs unpredictable and more secure.
 * 
 * Before: /hls/camera1/index.m3u8 (predictable)
 * After:  /hls/a1b2c3d4-e5f6-7890-abcd-ef1234567890/index.m3u8 (secure)
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

console.log('Running migration: add_stream_key');
console.log('Database path:', dbPath);

try {
    // Check if column already exists
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasStreamKey = tableInfo.some(col => col.name === 'stream_key');

    if (!hasStreamKey) {
        // Add stream_key column
        db.exec(`ALTER TABLE cameras ADD COLUMN stream_key TEXT`);
        console.log('✓ Added stream_key column');

        // Generate UUID for existing cameras
        const cameras = db.prepare('SELECT id FROM cameras').all();
        const updateStmt = db.prepare('UPDATE cameras SET stream_key = ? WHERE id = ?');
        
        for (const camera of cameras) {
            const streamKey = uuidv4();
            updateStmt.run(streamKey, camera.id);
            console.log(`  Generated stream_key for camera ${camera.id}: ${streamKey}`);
        }
        
        console.log(`✓ Generated stream_key for ${cameras.length} existing cameras`);

        // Create unique index on stream_key
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cameras_stream_key ON cameras(stream_key)`);
        console.log('✓ Created unique index on stream_key');
    } else {
        console.log('✓ stream_key column already exists');
        
        // Check for cameras without stream_key and generate for them
        const camerasWithoutKey = db.prepare('SELECT id FROM cameras WHERE stream_key IS NULL').all();
        if (camerasWithoutKey.length > 0) {
            const updateStmt = db.prepare('UPDATE cameras SET stream_key = ? WHERE id = ?');
            for (const camera of camerasWithoutKey) {
                const streamKey = uuidv4();
                updateStmt.run(streamKey, camera.id);
                console.log(`  Generated stream_key for camera ${camera.id}: ${streamKey}`);
            }
            console.log(`✓ Generated stream_key for ${camerasWithoutKey.length} cameras without key`);
        }
    }

    console.log('\n✅ Migration completed successfully!');
} catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
