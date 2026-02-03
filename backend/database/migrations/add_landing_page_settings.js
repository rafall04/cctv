/**
 * Migration: Add landing page customizable settings
 * Run: node backend/database/migrations/add_landing_page_settings.js
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Adding landing page settings...');
    
    // Check if settings table exists
    const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='settings'
    `).get();
    
    if (!tableExists) {
        console.log('⚠️  Table settings does not exist yet');
        console.log('   This migration will be skipped and should run after add_settings_table.js');
        console.log('✅ Migration skipped (will auto-run on next migration cycle)');
        process.exit(0);
    }
    
    const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, description) 
        VALUES (?, ?, ?)
    `);

    // Area coverage text
    insertSetting.run(
        'landing_area_coverage',
        'Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>',
        'Area coverage text displayed on landing page hero section'
    );
    console.log('✅ Added landing_area_coverage');

    // Hero badge text
    insertSetting.run(
        'landing_hero_badge',
        'LIVE STREAMING 24 JAM',
        'Badge text displayed above hero title'
    );
    console.log('✅ Added landing_hero_badge');

    // Section title
    insertSetting.run(
        'landing_section_title',
        'CCTV Publik',
        'Main section title for camera list'
    );
    console.log('✅ Added landing_section_title');

    console.log('\n✅ Migration completed successfully!');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
