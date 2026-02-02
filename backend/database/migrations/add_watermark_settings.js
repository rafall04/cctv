import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('=== Add Watermark Settings Migration ===');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

try {
    // Check if branding_settings table exists
    const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='branding_settings'
    `).get();
    
    if (!tableExists) {
        console.log('❌ Error: branding_settings table does not exist');
        console.log('⚠️  Please run add_branding_settings.js migration first');
        process.exit(1);
    }
    
    // Check if category column exists
    const tableInfo = db.prepare('PRAGMA table_info(branding_settings)').all();
    const hasCategory = tableInfo.some(col => col.name === 'category');
    
    if (!hasCategory) {
        console.log('➕ Adding category column to branding_settings...');
        db.exec('ALTER TABLE branding_settings ADD COLUMN category TEXT');
        console.log('✅ Category column added');
    }
    
    // Check existing settings
    const existingSettings = db.prepare('SELECT key FROM branding_settings').all();
    const existingKeys = existingSettings.map(s => s.key);
    
    console.log('Existing settings:', existingKeys.length);
    
    // Watermark settings to add
    const watermarkSettings = [
        {
            key: 'watermark_enabled',
            value: 'true',
            description: 'Enable watermark on snapshots',
            category: 'Watermark'
        },
        {
            key: 'watermark_text',
            value: '',
            description: 'Custom watermark text (leave empty to use company name)',
            category: 'Watermark'
        },
        {
            key: 'watermark_position',
            value: 'bottom-right',
            description: 'Watermark position (bottom-right, bottom-left, top-right, top-left)',
            category: 'Watermark'
        },
        {
            key: 'watermark_opacity',
            value: '0.9',
            description: 'Watermark opacity (0.1 - 1.0)',
            category: 'Watermark'
        }
    ];
    
    // Insert new settings
    const insertStmt = db.prepare(`
        INSERT INTO branding_settings (key, value, description, category)
        VALUES (?, ?, ?, ?)
    `);
    
    let added = 0;
    for (const setting of watermarkSettings) {
        if (!existingKeys.includes(setting.key)) {
            insertStmt.run(setting.key, setting.value, setting.description, setting.category);
            console.log(`✅ Added: ${setting.key}`);
            added++;
        } else {
            console.log(`⏭️  Skipped (exists): ${setting.key}`);
        }
    }
    
    console.log(`\n✅ Migration completed: ${added} settings added`);
    
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
