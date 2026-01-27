import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path ke database
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Adding sponsor fields to cameras table...');

    // Check if columns already exist
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasSponsors = tableInfo.some(col => 
        ['sponsor_name', 'sponsor_logo', 'sponsor_url', 'sponsor_package'].includes(col.name)
    );

    if (!hasSponsors) {
        // Add sponsor fields
        db.exec(`
            ALTER TABLE cameras ADD COLUMN sponsor_name TEXT;
            ALTER TABLE cameras ADD COLUMN sponsor_logo TEXT;
            ALTER TABLE cameras ADD COLUMN sponsor_url TEXT;
            ALTER TABLE cameras ADD COLUMN sponsor_package TEXT CHECK(sponsor_package IN ('bronze', 'silver', 'gold'));
        `);
        console.log('✅ Sponsor fields added successfully');
    } else {
        console.log('✅ Sponsor fields already exist');
    }

    // Create sponsors table for managing sponsors
    db.exec(`
        CREATE TABLE IF NOT EXISTS sponsors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            logo TEXT,
            url TEXT,
            package TEXT CHECK(package IN ('bronze', 'silver', 'gold')),
            price REAL,
            active INTEGER DEFAULT 1,
            start_date DATE,
            end_date DATE,
            contact_name TEXT,
            contact_email TEXT,
            contact_phone TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log('✅ Sponsors table created/verified');

    // Create banner_ads table for managing banner advertisements
    db.exec(`
        CREATE TABLE IF NOT EXISTS banner_ads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            position TEXT CHECK(position IN ('top', 'bottom', 'sidebar', 'inline')),
            size TEXT CHECK(size IN ('leaderboard', 'rectangle', 'skyscraper', 'mobile')),
            network TEXT CHECK(network IN ('medianet', 'adsterra', 'propellerads', 'custom')),
            code TEXT,
            active INTEGER DEFAULT 1,
            priority INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log('✅ Banner ads table created/verified');

    console.log('');
    console.log('✨ Migration completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Update schemaValidators.js to include sponsor fields');
    console.log('2. Update cameraController.js to handle sponsor data');
    console.log('3. Create sponsor management UI in admin panel');
    console.log('');

} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
