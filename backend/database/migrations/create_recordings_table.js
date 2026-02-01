import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: create recordings table...');
    
    // Check if table exists
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recordings'").get();

    if (!tableExists) {
        console.log('➕ Creating recordings table...');
        
        db.exec(`
            CREATE TABLE recordings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                camera_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                start_time DATETIME NOT NULL,
                end_time DATETIME,
                duration_seconds INTEGER,
                file_size_bytes INTEGER,
                status TEXT DEFAULT 'recording',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
            )
        `);
        
        console.log('✅ recordings table created successfully');
        
        // Create indexes
        console.log('➕ Creating indexes...');
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_recordings_camera_id ON recordings(camera_id);
            CREATE INDEX IF NOT EXISTS idx_recordings_start_time ON recordings(start_time);
            CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
            CREATE INDEX IF NOT EXISTS idx_recordings_camera_date ON recordings(camera_id, start_time);
        `);
        
        console.log('✅ Indexes created successfully');
    } else {
        console.log('✓ recordings table already exists');
    }
    
    console.log('✅ Migration completed successfully');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
