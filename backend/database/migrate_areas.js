// Migration script to add new columns to areas table
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = config.database.path.startsWith('/') 
  ? config.database.path 
  : join(__dirname, '..', config.database.path);

console.log('Running areas table migration...');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

// Check if columns exist
const tableInfo = db.prepare("PRAGMA table_info(areas)").all();
const columns = tableInfo.map(col => col.name);

const newColumns = [
    { name: 'rt', type: 'TEXT' },
    { name: 'rw', type: 'TEXT' },
    { name: 'kelurahan', type: 'TEXT' },
    { name: 'kecamatan', type: 'TEXT' },
];

for (const col of newColumns) {
    if (!columns.includes(col.name)) {
        console.log(`Adding column: ${col.name}`);
        db.exec(`ALTER TABLE areas ADD COLUMN ${col.name} ${col.type}`);
    } else {
        console.log(`Column ${col.name} already exists`);
    }
}

db.close();
console.log('✅ Migration completed successfully!');
