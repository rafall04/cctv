import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: create camera_discovery table...');
    
    // Check if table exists
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='camera_discovery'").get();

    if (!tableExists) {
        console.log('➕ Creating camera_discovery table...');
        
        db.exec(`
            CREATE TABLE camera_discovery (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_type TEXT NOT NULL,
                external_id TEXT,
                name TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                hls_url TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                matched_camera_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (matched_camera_id) REFERENCES cameras(id) ON DELETE SET NULL
            )
        `);
        
        console.log('✅ camera_discovery table created successfully');
        
        // Create indexes
        console.log('➕ Creating indexes...');
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_camera_discovery_source ON camera_discovery(source_type);
            CREATE INDEX IF NOT EXISTS idx_camera_discovery_status ON camera_discovery(status);
            CREATE INDEX IF NOT EXISTS idx_camera_discovery_matched ON camera_discovery(matched_camera_id);
        `);
        
        console.log('✅ Indexes created successfully');
    } else {
        console.log('✓ camera_discovery table already exists');
    }
    
    console.log('✅ Migration completed successfully');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
