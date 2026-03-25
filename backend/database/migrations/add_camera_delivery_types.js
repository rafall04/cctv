import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Running migration: add_camera_delivery_types');
console.log('Database path:', dbPath);

const db = new Database(dbPath);
const tableInfo = db.prepare('PRAGMA table_info(cameras)').all();

const ensureColumn = (name, definition) => {
    const exists = tableInfo.some((column) => column.name === name);
    if (exists) {
        console.log(`Column ${name} already exists, skipping`);
        return;
    }

    db.exec(`ALTER TABLE cameras ADD COLUMN ${definition}`);
    console.log(`Added column ${name}`);
};

ensureColumn('delivery_type', "delivery_type TEXT DEFAULT 'internal_hls'");
ensureColumn('external_stream_url', 'external_stream_url TEXT');
ensureColumn('external_embed_url', 'external_embed_url TEXT');
ensureColumn('external_snapshot_url', 'external_snapshot_url TEXT');
ensureColumn('external_origin_mode', "external_origin_mode TEXT DEFAULT 'direct'");

db.close();
console.log('Migration add_camera_delivery_types completed successfully!');
