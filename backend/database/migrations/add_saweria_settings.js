import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use relative path from migration file location
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('Creating saweria_settings table...');

    // Create saweria_settings table with leaderboard_link
    db.exec(`
        CREATE TABLE IF NOT EXISTS saweria_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            saweria_link TEXT NOT NULL DEFAULT 'https://saweria.co/raflialdi',
            leaderboard_link TEXT DEFAULT 'https://saweria.co/overlays/leaderboard/raflialdi',
            enabled INTEGER DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('✓ saweria_settings table created');

    // Check if leaderboard_link column exists (for existing tables)
    const tableInfo = db.prepare("PRAGMA table_info(saweria_settings)").all();
    const hasLeaderboardLink = tableInfo.some(col => col.name === 'leaderboard_link');

    if (!hasLeaderboardLink) {
        console.log('Adding leaderboard_link column...');
        db.exec(`ALTER TABLE saweria_settings ADD COLUMN leaderboard_link TEXT DEFAULT 'https://saweria.co/overlays/leaderboard/raflialdi'`);
        console.log('✓ leaderboard_link column added');
    }

    // Check if default settings exist
    const existingSettings = db.prepare('SELECT id FROM saweria_settings WHERE id = 1').get();

    if (!existingSettings) {
        console.log('Inserting default Saweria settings...');
        
        // Insert default settings with leaderboard link
        db.prepare(`
            INSERT INTO saweria_settings (
                id,
                saweria_link,
                leaderboard_link,
                enabled,
                updated_at
            ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
            1,
            'https://saweria.co/raflialdi',
            'https://saweria.co/overlays/leaderboard/raflialdi',
            1
        );

        console.log('✓ Default Saweria settings inserted');
    } else {
        console.log('✓ Saweria settings already exist');
        
        // Update existing settings to add leaderboard_link if null
        const currentSettings = db.prepare('SELECT leaderboard_link FROM saweria_settings WHERE id = 1').get();
        if (!currentSettings.leaderboard_link) {
            db.prepare('UPDATE saweria_settings SET leaderboard_link = ? WHERE id = 1')
                .run('https://saweria.co/overlays/leaderboard/raflialdi');
            console.log('✓ Default leaderboard_link added to existing settings');
        }
    }

    console.log('');
    console.log('✅ Migration completed successfully');
    console.log('');

} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
