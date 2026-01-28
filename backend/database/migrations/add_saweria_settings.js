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

    // Create saweria_settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS saweria_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            saweria_link TEXT NOT NULL DEFAULT 'https://saweria.co/raflialdi',
            enabled INTEGER DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('✓ saweria_settings table created');

    // Check if default settings exist
    const existingSettings = db.prepare('SELECT id FROM saweria_settings WHERE id = 1').get();

    if (!existingSettings) {
        console.log('Inserting default Saweria settings...');
        
        // Insert default settings
        db.prepare(`
            INSERT INTO saweria_settings (
                id,
                saweria_link,
                enabled,
                updated_at
            ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
            1,
            'https://saweria.co/raflialdi',
            1
        );

        console.log('✓ Default Saweria settings inserted');
    } else {
        console.log('✓ Saweria settings already exist');
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
