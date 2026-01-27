import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path ke database
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('Creating monetag_settings table...');

    // Create monetag_settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS monetag_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            popunder_enabled INTEGER DEFAULT 1,
            popunder_zone_id TEXT,
            native_banner_enabled INTEGER DEFAULT 1,
            native_banner_zone_id TEXT,
            push_notifications_enabled INTEGER DEFAULT 0,
            push_notifications_zone_id TEXT,
            social_bar_enabled INTEGER DEFAULT 0,
            social_bar_zone_id TEXT,
            direct_link_enabled INTEGER DEFAULT 0,
            direct_link_zone_id TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_by INTEGER,
            FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    console.log('✓ monetag_settings table created');

    // Check if default settings exist
    const existingSettings = db.prepare('SELECT id FROM monetag_settings WHERE id = 1').get();

    if (!existingSettings) {
        console.log('Inserting default Monetag settings...');
        
        // Insert default settings
        db.prepare(`
            INSERT INTO monetag_settings (
                id,
                popunder_enabled,
                popunder_zone_id,
                native_banner_enabled,
                native_banner_zone_id,
                push_notifications_enabled,
                push_notifications_zone_id,
                social_bar_enabled,
                social_bar_zone_id,
                direct_link_enabled,
                direct_link_zone_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            1,
            1, // popunder_enabled
            'YOUR_POPUNDER_ZONE_ID',
            1, // native_banner_enabled
            'YOUR_NATIVE_ZONE_ID',
            0, // push_notifications_enabled
            'YOUR_PUSH_ZONE_ID',
            0, // social_bar_enabled
            'YOUR_SOCIAL_BAR_ZONE_ID',
            0, // direct_link_enabled
            'YOUR_DIRECT_LINK_ZONE_ID'
        );

        console.log('✓ Default Monetag settings inserted');
    } else {
        console.log('✓ Monetag settings already exist');
    }

    console.log('\n✅ Migration completed successfully!');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
