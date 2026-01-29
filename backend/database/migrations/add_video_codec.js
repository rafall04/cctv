import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use relative path from migration file location
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting video_codec migration...');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

try {
    // Check if column exists
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasColumn = tableInfo.some(col => col.name === 'video_codec');

    if (!hasColumn) {
        console.log('Adding video_codec column to cameras table...');
        
        // Add column with default value and CHECK constraint
        db.exec(`
            ALTER TABLE cameras 
            ADD COLUMN video_codec TEXT DEFAULT 'h264' 
            CHECK(video_codec IN ('h264', 'h265'))
        `);
        
        console.log('✓ video_codec column added successfully');
        console.log('✓ Default value: h264');
        console.log('✓ CHECK constraint: h264 or h265 only');
    } else {
        console.log('✓ video_codec column already exists');
    }

    // Verify the column
    const updatedTableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const codecColumn = updatedTableInfo.find(col => col.name === 'video_codec');
    
    if (codecColumn) {
        console.log('\nColumn details:');
        console.log('  Name:', codecColumn.name);
        console.log('  Type:', codecColumn.type);
        console.log('  Default:', codecColumn.dflt_value);
        console.log('  Not Null:', codecColumn.notnull);
    }

    console.log('\n✅ Migration completed successfully');
} catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
} finally {
    db.close();
}
