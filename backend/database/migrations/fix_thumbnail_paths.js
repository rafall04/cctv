import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('[Migration] Fixing thumbnail paths...');

const db = new Database(dbPath);

try {
    // Update all thumbnail paths from /thumbnails/ to /api/thumbnails/
    const result = db.prepare(`
        UPDATE cameras 
        SET thumbnail_path = REPLACE(thumbnail_path, '/thumbnails/', '/api/thumbnails/')
        WHERE thumbnail_path LIKE '/thumbnails/%'
    `).run();

    console.log(`✅ Updated ${result.changes} thumbnail paths`);
    
    // Show sample of updated paths
    const samples = db.prepare(`
        SELECT id, name, thumbnail_path 
        FROM cameras 
        WHERE thumbnail_path IS NOT NULL 
        LIMIT 5
    `).all();
    
    if (samples.length > 0) {
        console.log('\nSample updated paths:');
        samples.forEach(cam => {
            console.log(`  Camera ${cam.id} (${cam.name}): ${cam.thumbnail_path}`);
        });
    }
    
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
