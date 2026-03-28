import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../../data/cctv.db');

const DEFAULT_SETTINGS = [
    ['public_playback_enabled', 'true'],
    ['public_playback_preview_minutes', '10'],
    ['public_playback_notice_enabled', 'true'],
    ['public_playback_notice_title', 'Akses Playback Publik Terbatas'],
    ['public_playback_notice_text', 'Playback publik dibatasi untuk menjaga privasi. Untuk akses lebih lanjut silakan hubungi admin.'],
    ['public_playback_contact_mode', 'branding_whatsapp'],
];

function hasColumn(db, tableName, columnName) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((column) => column.name === columnName);
}

try {
    const db = new Database(dbPath);

    if (!hasColumn(db, 'cameras', 'public_playback_mode')) {
        db.exec(`
            ALTER TABLE cameras
            ADD COLUMN public_playback_mode TEXT NOT NULL DEFAULT 'inherit'
        `);
    }

    if (!hasColumn(db, 'cameras', 'public_playback_preview_minutes')) {
        db.exec(`
            ALTER TABLE cameras
            ADD COLUMN public_playback_preview_minutes INTEGER
        `);
    }

    const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, description)
        VALUES (?, ?, ?)
    `);

    DEFAULT_SETTINGS.forEach(([key, value]) => {
        insertSetting.run(key, value, `Playback control setting for ${key}`);
    });

    console.log('✅ Public playback controls migration completed');
    db.close();
} catch (error) {
    console.error('❌ Failed to add public playback controls:', error);
    process.exitCode = 1;
}
