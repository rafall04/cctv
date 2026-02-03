import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('[Migration] Adding thumbnail columns to cameras table...');

const db = new Database(dbPath);

try {
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasThumbnailPath = tableInfo.some(col => col.name === 'thumbnail_path');
    const hasThumbnailUpdatedAt = tableInfo.some(col => col.name === 'thumbnail_updated_at');

    if (!hasThumbnailPath) {
        db.exec(`ALTER TABLE cameras ADD COLUMN thumbnail_path TEXT DEFAULT NULL`);
        console.log('✅ Added thumbnail_path column');
    } else {
        console.log('ℹ️  thumbnail_path column already exists');
    }

    if (!hasThumbnailUpdatedAt) {
        db.exec(`ALTER TABLE cameras ADD COLUMN thumbnail_updated_at DATETIME DEFAULT NULL`);
        console.log('✅ Added thumbnail_updated_at column');
    } else {
        console.log('ℹ️  thumbnail_updated_at column already exists');
    }

    console.log('✅ Migration completed successfully');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
