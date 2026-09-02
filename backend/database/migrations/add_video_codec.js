/**
 * Migration: Add video_codec column to cameras table
 * 
 * Adds video_codec field to store camera codec information (H264, H265, etc.)
 * This is used for codec compatibility warnings in the frontend.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: add_video_codec...');
    
    // Check if column exists
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasVideoCodec = tableInfo.some(col => col.name === 'video_codec');

    if (!hasVideoCodec) {
        console.log('➕ Adding video_codec column to cameras table...');
        
        // Add video_codec column (nullable, default NULL)
        db.exec(`ALTER TABLE cameras ADD COLUMN video_codec TEXT DEFAULT NULL`);
        
        console.log('✅ video_codec column added');
        
        // Set default value for existing cameras (H264 is most common)
        const result = db.prepare(`
            UPDATE cameras 
            SET video_codec = 'H264' 
            WHERE video_codec IS NULL
        `).run();
        
        console.log(`✅ Updated ${result.changes} existing cameras with default codec (H264)`);
    } else {
        console.log('✓ video_codec column already exists');
    }
    
    console.log('✅ Migration completed successfully');
    process.exit(0);
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
