import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', 'data', 'cctv.db');
const recordingsPath = join(__dirname, '..', '..', 'recordings');

console.log('='.repeat(70));
console.log('RECORDING SYSTEM DIAGNOSTIC');
console.log('='.repeat(70));
console.log('');

const db = new Database(dbPath);

// 1. Check cameras with recording enabled
console.log('1. CAMERAS WITH RECORDING ENABLED:');
console.log('-'.repeat(70));
const cameras = db.prepare(`
    SELECT id, name, enable_recording, enabled, recording_status, recording_duration_hours
    FROM cameras
    WHERE enable_recording = 1
`).all();

if (cameras.length === 0) {
    console.log('❌ NO CAMERAS WITH RECORDING ENABLED');
    console.log('');
    console.log('SOLUTION:');
    console.log('  1. Go to Camera Management');
    console.log('  2. Edit a camera');
    console.log('  3. Enable "Enable Recording" checkbox');
    console.log('  4. Set recording duration (e.g., 5 hours)');
    console.log('  5. Save');
} else {
    cameras.forEach(cam => {
        console.log(`Camera ${cam.id}: ${cam.name}`);
        console.log(`  - Enabled: ${cam.enabled ? 'Yes' : 'No'}`);
        console.log(`  - Recording Enabled: ${cam.enable_recording ? 'Yes' : 'No'}`);
        console.log(`  - Recording Status: ${cam.recording_status || 'N/A'}`);
        console.log(`  - Retention: ${cam.recording_duration_hours || 5} hours`);
        console.log('');
    });
}

// 2. Check recording_segments table
console.log('2. RECORDING SEGMENTS IN DATABASE:');
console.log('-'.repeat(70));
const segments = db.prepare('SELECT COUNT(*) as count FROM recording_segments').get();
console.log(`Total segments: ${segments.count}`);

if (segments.count > 0) {
    const recent = db.prepare(`
        SELECT camera_id, filename, start_time, file_size
        FROM recording_segments
        ORDER BY start_time DESC
        LIMIT 5
    `).all();
    
    console.log('\nRecent segments:');
    recent.forEach(seg => {
        console.log(`  - Camera ${seg.camera_id}: ${seg.filename} (${(seg.file_size / 1024 / 1024).toFixed(2)} MB)`);
    });
}
console.log('');

// 3. Check recordings directory
console.log('3. RECORDINGS DIRECTORY:');
console.log('-'.repeat(70));
console.log(`Path: ${recordingsPath}`);
console.log(`Exists: ${existsSync(recordingsPath) ? 'Yes' : 'No'}`);

if (!existsSync(recordingsPath)) {
    console.log('');
    console.log('❌ RECORDINGS DIRECTORY DOES NOT EXIST');
    console.log('');
    console.log('SOLUTION:');
    console.log('  This is normal if recording has never been started.');
    console.log('  The directory will be created automatically when recording starts.');
}
console.log('');

// 4. Check if recording service is configured
console.log('4. RECORDING SERVICE STATUS:');
console.log('-'.repeat(70));

if (cameras.length > 0 && cameras.some(c => c.enabled && c.enable_recording)) {
    console.log('✓ Cameras configured for recording');
    console.log('');
    console.log('NEXT STEPS:');
    console.log('  1. Ensure backend server is running: npm run dev');
    console.log('  2. Check backend logs for recording messages');
    console.log('  3. Wait 5-10 seconds for auto-start');
    console.log('  4. Check if FFmpeg process is running');
    console.log('  5. Monitor for segment creation messages');
} else {
    console.log('❌ No cameras ready for recording');
    console.log('');
    console.log('REQUIREMENTS:');
    console.log('  - Camera must be enabled (enabled = 1)');
    console.log('  - Recording must be enabled (enable_recording = 1)');
}
console.log('');

// 5. Summary
console.log('='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));

const issues = [];
if (cameras.length === 0) {
    issues.push('No cameras have recording enabled');
}
if (cameras.some(c => !c.enabled && c.enable_recording)) {
    issues.push('Some cameras have recording enabled but camera is disabled');
}
if (segments.count === 0 && cameras.length > 0) {
    issues.push('Cameras configured but no segments recorded yet');
}

if (issues.length > 0) {
    console.log('ISSUES FOUND:');
    issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`);
    });
} else {
    console.log('✓ Recording system appears to be configured correctly');
}

console.log('');
console.log('='.repeat(70));

db.close();
