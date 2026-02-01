import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: add stream_key field...');
    
    // Check if column exists
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasColumn = tableInfo.some(col => col.name === 'stream_key');

    if (!hasColumn) {
        console.log('➕ Adding stream_key column...');
        
        // Add stream_key column (TEXT only, UNIQUE constraint added later)
        db.exec(`ALTER TABLE cameras ADD COLUMN stream_key TEXT`);
        
        console.log('✅ stream_key column added successfully');
        
        // Generate UUIDs for existing cameras
        const cameras = db.prepare('SELECT id FROM cameras').all();
        const updateStmt = db.prepare('UPDATE cameras SET stream_key = ? WHERE id = ?');
        
        let updated = 0;
        for (const camera of cameras) {
            const uuid = randomUUID();
            updateStmt.run(uuid, camera.id);
            updated++;
        }
        
        console.log(`✅ Generated stream_keys for ${updated} existing cameras`);
        
        // Create UNIQUE index after populating data
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cameras_stream_key ON cameras(stream_key)`);
        console.log('✅ Created UNIQUE index on stream_key');
    } else {
        console.log('✓ stream_key column already exists');
        
        // Check if any cameras have NULL stream_key
        const nullCount = db.prepare('SELECT COUNT(*) as count FROM cameras WHERE stream_key IS NULL').get();
        if (nullCount.count > 0) {
            console.log(`➕ Generating stream_keys for ${nullCount.count} cameras with NULL stream_key...`);
            
            const cameras = db.prepare('SELECT id FROM cameras WHERE stream_key IS NULL').all();
            const updateStmt = db.prepare('UPDATE cameras SET stream_key = ? WHERE id = ?');
            
            for (const camera of cameras) {
                const uuid = randomUUID();
                updateStmt.run(uuid, camera.id);
            }
            
            console.log(`✅ Generated stream_keys for ${nullCount.count} cameras`);
        }
    }
    
    console.log('✅ Migration completed successfully');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
