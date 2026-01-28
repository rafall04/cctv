import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path ke database
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('Starting recording system migration...');

    // 1. Tambah kolom recording di cameras table
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    
    if (!tableInfo.some(col => col.name === 'enable_recording')) {
        db.exec(`ALTER TABLE cameras ADD COLUMN enable_recording INTEGER DEFAULT 0`);
        console.log('✓ Added enable_recording column');
    }
    
    if (!tableInfo.some(col => col.name === 'recording_duration_hours')) {
        db.exec(`ALTER TABLE cameras ADD COLUMN recording_duration_hours INTEGER DEFAULT 5`);
        console.log('✓ Added recording_duration_hours column');
    }
    
    if (!tableInfo.some(col => col.name === 'recording_status')) {
        db.exec(`ALTER TABLE cameras ADD COLUMN recording_status TEXT DEFAULT 'stopped'`);
        console.log('✓ Added recording_status column');
    }
    
    if (!tableInfo.some(col => col.name === 'last_recording_start')) {
        db.exec(`ALTER TABLE cameras ADD COLUMN last_recording_start DATETIME`);
        console.log('✓ Added last_recording_start column');
    }

    // 2. Buat tabel recording_segments
    db.exec(`
        CREATE TABLE IF NOT EXISTS recording_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            start_time DATETIME NOT NULL,
            end_time DATETIME NOT NULL,
            file_size INTEGER NOT NULL,
            duration INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        )
    `);
    console.log('✓ Created recording_segments table');

    // Index untuk performa
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_segments_camera_time 
        ON recording_segments(camera_id, start_time)
    `);
    console.log('✓ Created index on recording_segments');

    // 3. Buat tabel restart_logs
    db.exec(`
        CREATE TABLE IF NOT EXISTS restart_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            restart_time DATETIME NOT NULL,
            recovery_time DATETIME,
            success INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        )
    `);
    console.log('✓ Created restart_logs table');

    // Index untuk performa
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_restart_camera_time 
        ON restart_logs(camera_id, restart_time)
    `);
    console.log('✓ Created index on restart_logs');

    console.log('\n✅ Recording system migration completed successfully!');

} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
