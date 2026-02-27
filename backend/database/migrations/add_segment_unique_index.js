import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to database
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('Starting segment unique index migration...');

    // 1. Remove duplicates before creating unique index
    // We keep the one with the highest ID (latest entry)
    console.log('Cleaning up duplicate recording segments...');
    db.exec(`
        DELETE FROM recording_segments 
        WHERE id NOT IN (
            SELECT MAX(id)
            FROM recording_segments
            GROUP BY camera_id, filename
        )
    `);
    console.log('✓ Cleaned up duplicates');

    // 2. Create unique index on (camera_id, filename)
    console.log('Creating unique index idx_segments_cam_file...');
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_cam_file 
        ON recording_segments (camera_id, filename)
    `);
    console.log('✓ Created unique index on recording_segments(camera_id, filename)');

    console.log('\n✅ Unique index migration completed successfully!');

} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
