import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const db = new Database('./data/cctv.db', { readonly: true });

// List all cameras first
console.log('\nAll cameras:');
const allCameras = db.prepare('SELECT id, name FROM cameras').all();
allCameras.forEach(c => console.log(`  ${c.id}. ${c.name}`));

// Find EZVIZ camera
const camera = db.prepare("SELECT * FROM cameras WHERE name LIKE '%EZVIZ%'").get();
console.log('\nEZVIZ Camera:', camera ? `${camera.id}. ${camera.name}` : 'NOT FOUND');

if (!camera) {
    console.log('EZVIZ camera not found!');
    db.close();
    process.exit(0);
}

const cameraId = camera.id;

// Get recordings from database
const dbRecs = db.prepare('SELECT filename, status, start_time FROM recordings WHERE camera_id = ? ORDER BY start_time DESC').all(cameraId);
console.log(`\nDatabase recordings: ${dbRecs.length}`);
dbRecs.forEach((r, i) => {
    console.log(`${i + 1}. ${r.filename} - ${r.status}`);
});

// Get files from filesystem
const dir = `/var/www/rafnet-cctv/recordings/camera${cameraId}`;
if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).sort();
    console.log(`\nFilesystem files: ${files.length}`);
    files.forEach((f, i) => {
        const inDb = dbRecs.some(r => r.filename === f);
        console.log(`${i + 1}. ${f} - ${inDb ? 'IN DB' : 'MISSING IN DB'}`);
    });
    
    // Find missing
    const missing = files.filter(f => !dbRecs.some(r => r.filename === f));
    console.log(`\n⚠️ Missing in database: ${missing.length} files`);
    missing.forEach(f => console.log(`   - ${f}`));
} else {
    console.log(`\nDirectory not found: ${dir}`);
}

db.close();
