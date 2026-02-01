import Database from 'better-sqlite3';

const db = new Database('./data/cctv.db');
const cameras = db.prepare('SELECT id, name, stream_key, enabled FROM cameras ORDER BY id').all();

console.log('All cameras:');
cameras.forEach(cam => {
    console.log(`- ID ${cam.id}: ${cam.name} | stream_key: ${cam.stream_key} | enabled: ${cam.enabled}`);
});

db.close();
