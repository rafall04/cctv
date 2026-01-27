import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path ke database
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('📍 Database path:', dbPath);

const db = new Database(dbPath);

try {
    console.log('🔍 Checking monetag_settings table...');
    console.log('');

    // Check if table exists
    const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='monetag_settings'
    `).get();

    if (!tableExists) {
        console.log('⚠️  Table monetag_settings does not exist');
        console.log('🔄 Creating monetag_settings table...');
        
        db.exec(`
            CREATE TABLE monetag_settings (
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
        
        console.log('✅ Table created successfully');
    } else {
        console.log('✅ Table monetag_settings exists');
    }

    // Get current table structure
    const tableInfo = db.prepare("PRAGMA table_info(monetag_settings)").all();
    
    console.log('');
    console.log('Current columns:');
    tableInfo.forEach(col => {
        console.log(`  - ${col.name} (${col.type})`);
    });

    // Required columns
    const requiredColumns = {
        'id': 'INTEGER',
        'popunder_enabled': 'INTEGER',
        'popunder_zone_id': 'TEXT',
        'native_banner_enabled': 'INTEGER',
        'native_banner_zone_id': 'TEXT',
        'push_notifications_enabled': 'INTEGER',
        'push_notifications_zone_id': 'TEXT',
        'social_bar_enabled': 'INTEGER',
        'social_bar_zone_id': 'TEXT',
        'direct_link_enabled': 'INTEGER',
        'direct_link_zone_id': 'TEXT',
        'updated_at': 'DATETIME',
        'updated_by': 'INTEGER'
    };

    // Check for missing columns
    const existingColumns = tableInfo.map(col => col.name);
    const missingColumns = Object.keys(requiredColumns).filter(
        col => !existingColumns.includes(col)
    );

    if (missingColumns.length > 0) {
        console.log('');
        console.log('⚠️  Missing columns detected:', missingColumns.join(', '));
        console.log('🔄 Adding missing columns...');

        for (const column of missingColumns) {
            const type = requiredColumns[column];
            let sql = `ALTER TABLE monetag_settings ADD COLUMN ${column} ${type}`;
            
            // Add defaults for specific columns
            if (column.includes('_enabled')) {
                sql += ' DEFAULT 0';
            } else if (column === 'updated_at') {
                sql += ' DEFAULT CURRENT_TIMESTAMP';
            }

            try {
                db.exec(sql);
                console.log(`  ✅ Added column: ${column}`);
            } catch (error) {
                console.error(`  ❌ Failed to add ${column}:`, error.message);
            }
        }
    } else {
        console.log('');
        console.log('✅ All required columns exist');
    }

    // Check if default settings exist
    console.log('');
    console.log('🔍 Checking default settings...');
    const existingSettings = db.prepare('SELECT * FROM monetag_settings WHERE id = 1').get();

    if (!existingSettings) {
        console.log('⚠️  No default settings found');
        console.log('🔄 Inserting default settings...');
        
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
            0, // popunder_enabled - disabled by default
            '',
            0, // native_banner_enabled - disabled by default
            '',
            0, // push_notifications_enabled
            '',
            0, // social_bar_enabled
            '',
            0, // direct_link_enabled
            ''
        );

        console.log('✅ Default settings inserted');
    } else {
        console.log('✅ Default settings exist');
        console.log('');
        console.log('Current settings:');
        console.log(`  - Popunder: ${existingSettings.popunder_enabled ? 'Enabled' : 'Disabled'} (Zone: ${existingSettings.popunder_zone_id || 'Not set'})`);
        console.log(`  - Native Banner: ${existingSettings.native_banner_enabled ? 'Enabled' : 'Disabled'} (Zone: ${existingSettings.native_banner_zone_id || 'Not set'})`);
        console.log(`  - Push Notifications: ${existingSettings.push_notifications_enabled ? 'Enabled' : 'Disabled'} (Zone: ${existingSettings.push_notifications_zone_id || 'Not set'})`);
        console.log(`  - Social Bar: ${existingSettings.social_bar_enabled ? 'Enabled' : 'Disabled'} (Zone: ${existingSettings.social_bar_zone_id || 'Not set'})`);
        console.log(`  - Direct Link: ${existingSettings.direct_link_enabled ? 'Enabled' : 'Disabled'} (Zone: ${existingSettings.direct_link_zone_id || 'Not set'})`);
    }

    console.log('');
    console.log('✨ Migration completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Access admin panel: https://cctv.raf.my.id/admin/monetag');
    console.log('2. Configure your Monetag zone IDs');
    console.log('3. Enable desired ad formats');
    console.log('');

} catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('');
    console.error('Error details:', error.message);
    process.exit(1);
} finally {
    db.close();
}
