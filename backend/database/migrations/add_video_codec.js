import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// PENTING: Gunakan path relatif dari lokasi file migration
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: add video_codec field...');
    
    // Check if column exists
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasColumn = tableInfo.some(col => col.name === 'video_codec');

    if (!hasColumn) {
        console.log('➕ Adding video_codec column...');
        
        // Add video_codec column with default 'h264'
        db.exec(`ALTER TABLE cameras ADD COLUMN video_codec TEXT DEFAULT 'h264'`);
        
        console.log('✅ video_codec column added successfully');
        
        // Update existing cameras to have h264 as default
        const result = db.prepare(`UPDATE cameras SET video_codec = 'h264' WHERE video_codec IS NULL`).run();
        console.log(`✅ Updated ${result.changes} existing cameras with default codec h264`);
    } else {
        console.log('✓ video_codec column already exists');
    }
    
    console.log('✅ Migration completed successfully');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
