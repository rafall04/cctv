import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, 'data/cctv.db');

try {
    const db = new Database(dbPath);
    console.log('Connected to database at:', dbPath);

    const cameras = db.prepare('SELECT id, name, group_name, enabled FROM cameras').all();
    console.log('All Cameras in Database:');
    console.table(cameras);

    db.close();
} catch (error) {
    console.error('Database diagnostic error:', error);
}
