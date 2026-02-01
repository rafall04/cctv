import Database from 'better-sqlite3';

const db = new Database('./data/cctv.db');
const camera = db.prepare('SELECT id, name, stream_key, enabled FROM cameras WHERE id = 9').get();

console.log('Camera 9:', JSON.stringify(camera, null, 2));

db.close();
