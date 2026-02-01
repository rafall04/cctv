import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', 'data', 'cctv.db');

const db = new Database(dbPath, { readonly: true });

console.log('================================================================================');
console.log('DIAGNOSIS: Camera 11 (TES EZVIZ) Recording Mismatch');
console.log('================================================================================\n');

// 1. Check camera info
const camera = db.prepare('SELECT * FROM cameras WHERE id = 11').get();
console.log('1. CAMERA INFO:');
console.log(`   Name: ${camera.name}`);
console.log(`   Recording enabled: ${camera.enable_recording}`);
console.log(`   Is recording: ${camera.is_recording}`);
console.log(`   Retention: ${camera.recording_duration_hours} hours\n`);

// 2. Check database recordings
const dbRecordings = db.prepare(`
    SELECT id, filename, filepath, start_time, end_time, duration_seconds, 
           file_size_bytes, status, created_at
    FROM recordings 
    WHERE camera_id = 11 
    ORDER BY start_time DESC
`).all();

console.log('2. DATABASE RECORDINGS:');
console.log(`   Total in database: ${dbRecordings.length}`);
if (dbRecordings.length > 0) {
    console.log('\n   Details:');
    dbRecordings.forEach((rec, idx) => {
        const ageHours = ((Date.now() - new Date(rec.start_time).getTime()) / (1000 * 60 * 60)).toFixed(1);
        console.log(`   ${idx + 1}. ${rec.filename}`);
        console.log(`      Status: ${rec.status}`);
        console.log(`      Start: ${rec.start_time}`);
        console.log(`      Age: ${ageHours}h`);
        console.log(`      Size: ${(rec.file_size_bytes / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`      Path: ${rec.filepath}`);
    });
}

// 3. Check filesystem
const recordingsDir = '/var/www/rafnet-cctv/recordings/camera11';
console.log('\n3. FILESYSTEM FILES:');

if (fs.existsSync(recordingsDir)) {
    const files = fs.readdirSync(recordingsDir)
        .filter(f => f.endsWith('.mp4'))
        .map(f => {
            const filepath = path.join(recordingsDir, f);
            const stats = fs.statSync(filepath);
            const ageMs = Date.now() - stats.mtimeMs;
            const ageHours = (ageMs / (1000 * 60 * 60)).toFixed(1);
            return {
                filename: f,
                filepath,
                size: stats.size,
                mtime: stats.mtime,
                ageHours
            };
        })
        .sort((a, b) => b.mtime - a.mtime); // Newest first

    console.log(`   Total files: ${files.length}\n`);
    
    if (files.length > 0) {
        console.log('   Details:');
        files.forEach((file, idx) => {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            const inDb = dbRecordings.some(r => r.filename === file.filename);
            console.log(`   ${idx + 1}. ${file.filename}`);
            console.log(`      Size: ${sizeMB} MB`);
            console.log(`      Age: ${file.ageHours}h`);
            console.log(`      Modified: ${file.mtime.toISOString()}`);
            console.log(`      In database: ${inDb ? '✓ YES' : '✗ NO'}`);
        });
    }
} else {
    console.log(`   Directory not found: ${recordingsDir}`);
}

// 4. Find missing files
console.log('\n4. MISMATCH ANALYSIS:');
if (fs.existsSync(recordingsDir)) {
    const filesInFs = fs.readdirSync(recordingsDir)
        .filter(f => f.endsWith('.mp4'));
    const filesInDb = dbRecordings.map(r => r.filename);
    
    const missingInDb = filesInFs.filter(f => !filesInDb.includes(f));
    const missingInFs = filesInDb.filter(f => !filesInFs.includes(f));
    
    console.log(`   Files in filesystem: ${filesInFs.length}`);
    console.log(`   Files in database: ${filesInDb.length}`);
    console.log(`   Missing in database: ${missingInDb.length}`);
    console.log(`   Missing in filesystem: ${missingInFs.length}\n`);
    
    if (missingInDb.length > 0) {
        console.log('   ⚠️ FILES IN FILESYSTEM BUT NOT IN DATABASE:');
        missingInDb.forEach(f => {
            const filepath = path.join(recordingsDir, f);
            const stats = fs.statSync(filepath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            const ageHours = ((Date.now() - stats.mtimeMs) / (1000 * 60 * 60)).toFixed(1);
            console.log(`      - ${f} (${sizeMB} MB, age: ${ageHours}h)`);
        });
    }
    
    if (missingInFs.length > 0) {
        console.log('\n   ⚠️ FILES IN DATABASE BUT NOT IN FILESYSTEM:');
        missingInFs.forEach(f => {
            const rec = dbRecordings.find(r => r.filename === f);
            console.log(`      - ${f} (status: ${rec.status})`);
        });
    }
}

// 5. Check playback query
console.log('\n5. PLAYBACK QUERY SIMULATION:');
const playbackRecordings = db.prepare(`
    SELECT id, filename, start_time, end_time, duration_seconds, file_size_bytes
    FROM recordings
    WHERE camera_id = 11
    AND status = 'completed'
    ORDER BY start_time DESC
`).all();

console.log(`   Recordings returned by playback API: ${playbackRecordings.length}`);
if (playbackRecordings.length > 0) {
    console.log('\n   Details:');
    playbackRecordings.forEach((rec, idx) => {
        console.log(`   ${idx + 1}. ${rec.filename}`);
        console.log(`      Start: ${rec.start_time}`);
        console.log(`      Duration: ${rec.duration_seconds}s`);
    });
}

console.log('\n================================================================================');
console.log('CONCLUSION:');
console.log('================================================================================');

if (fs.existsSync(recordingsDir)) {
    const filesInFs = fs.readdirSync(recordingsDir).filter(f => f.endsWith('.mp4'));
    const filesInDb = dbRecordings.map(r => r.filename);
    const missingInDb = filesInFs.filter(f => !filesInDb.includes(f));
    
    if (missingInDb.length > 0) {
        console.log('ROOT CAUSE: Files exist in filesystem but NOT in database');
        console.log(`Missing entries: ${missingInDb.length} files`);
        console.log('\nPOSSIBLE REASONS:');
        console.log('1. Recording service crashed before writing to database');
        console.log('2. Database transaction failed but file was created');
        console.log('3. Manual file copy without database entry');
        console.log('4. Recording service restarted during segment creation');
        console.log('\nSOLUTION: Run sync script to add missing files to database');
    } else if (playbackRecordings.length < dbRecordings.length) {
        console.log('ROOT CAUSE: Some recordings have status != "completed"');
        console.log('SOLUTION: Update recording status or check why they are not completed');
    } else {
        console.log('No obvious mismatch found. All files are in database.');
    }
}

console.log('================================================================================\n');

db.close();
