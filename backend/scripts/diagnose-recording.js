#!/usr/bin/env node

/**
 * Diagnostic script untuk recording issue
 * Jalankan dari root project: node backend/scripts/diagnose-recording.js
 * Atau dari backend: node scripts/diagnose-recording.js
 */

import Database from 'better-sqlite3';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Detect if running from backend/ or root
const isInBackend = __dirname.includes('/backend/scripts');
const rootPath = isInBackend ? join(__dirname, '..', '..') : __dirname;
const dbPath = join(rootPath, 'backend', 'data', 'cctv.db');
const recordingsPath = join(rootPath, 'recordings');

console.log('Working directory:', process.cwd());
console.log('Root path:', rootPath);
console.log('DB path:', dbPath);
console.log('Recordings path:', recordingsPath);
console.log('');

if (!existsSync(dbPath)) {
    console.error('❌ Database not found at:', dbPath);
    console.error('Please run this script from project root or backend directory');
    process.exit(1);
}

const db = new Database(dbPath);

console.log('='.repeat(80));
console.log('DIAGNOSTIC: Recording System');
console.log('='.repeat(80));
console.log('');

// 1. Check cameras with recording enabled
console.log('1. CAMERAS WITH RECORDING ENABLED:');
console.log('-'.repeat(80));
const cameras = db.prepare(`
    SELECT id, name, enable_recording, recording_duration_hours, enabled 
    FROM cameras 
    WHERE enable_recording = 1
`).all();

console.log(`Found ${cameras.length} cameras with recording enabled:\n`);
cameras.forEach(cam => {
    console.log(`  Camera ${cam.id}: ${cam.name}`);
    console.log(`    - Enabled: ${cam.enabled ? 'YES' : 'NO'}`);
    console.log(`    - Duration: ${cam.recording_duration_hours} hours`);
    console.log(`    - Max segments: ${cam.recording_duration_hours * 6}`);
    console.log('');
});

// 2. Check database segments
console.log('2. DATABASE SEGMENTS:');
console.log('-'.repeat(80));
cameras.forEach(cam => {
    const segments = db.prepare(`
        SELECT id, filename, start_time, file_path, file_size
        FROM recording_segments 
        WHERE camera_id = ?
        ORDER BY start_time DESC
    `).all(cam.id);
    
    console.log(`  Camera ${cam.id} (${cam.name}): ${segments.length} segments in DB`);
    
    if (segments.length > 0) {
        console.log(`    Latest 3 segments:`);
        segments.slice(0, 3).forEach(seg => {
            const age = Math.round((Date.now() - new Date(seg.start_time).getTime()) / 60000);
            const exists = existsSync(seg.file_path);
            console.log(`      - ${seg.filename} (${age}min ago) - File exists: ${exists ? 'YES' : 'NO'}`);
            if (!exists) {
                console.log(`        Path: ${seg.file_path}`);
            }
        });
    }
    console.log('');
});

// 3. Check filesystem
console.log('3. FILESYSTEM CHECK:');
console.log('-'.repeat(80));
if (existsSync(recordingsPath)) {
    const dirs = readdirSync(recordingsPath);
    
    dirs.forEach(dir => {
        const dirPath = join(recordingsPath, dir);
        if (statSync(dirPath).isDirectory()) {
            const files = readdirSync(dirPath).filter(f => f.endsWith('.mp4') && !f.includes('.temp') && !f.includes('.remux'));
            
            console.log(`  ${dir}: ${files.length} MP4 files`);
            
            if (files.length > 0) {
                console.log(`    Latest 3 files:`);
                files.slice(0, 3).forEach(file => {
                    const filePath = join(dirPath, file);
                    const stats = statSync(filePath);
                    const age = Math.round((Date.now() - stats.mtimeMs) / 60000);
                    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
                    console.log(`      - ${file} (${age}min ago, ${sizeMB} MB)`);
                });
            }
            console.log('');
        }
    });
} else {
    console.log('  ⚠️ Recordings directory not found!');
    console.log(`     Expected at: ${recordingsPath}`);
}

// 4. Check for orphaned files (in filesystem but not in DB)
console.log('4. ORPHANED FILES CHECK:');
console.log('-'.repeat(80));
if (existsSync(recordingsPath)) {
    const dirs = readdirSync(recordingsPath);
    
    dirs.forEach(dir => {
        const match = dir.match(/camera(\d+)/);
        if (!match) return;
        
        const cameraId = parseInt(match[1]);
        const dirPath = join(recordingsPath, dir);
        
        if (statSync(dirPath).isDirectory()) {
            const files = readdirSync(dirPath).filter(f => f.endsWith('.mp4') && !f.includes('.temp') && !f.includes('.remux'));
            
            files.forEach(file => {
                const segment = db.prepare(`
                    SELECT id FROM recording_segments 
                    WHERE camera_id = ? AND filename = ?
                `).get(cameraId, file);
                
                if (!segment) {
                    const filePath = join(dirPath, file);
                    const stats = statSync(filePath);
                    const age = Math.round((Date.now() - stats.mtimeMs) / 60000);
                    console.log(`  ⚠️ Orphaned: ${dir}/${file} (${age}min ago, not in DB)`);
                }
            });
        }
    });
}

// 5. Check for missing files (in DB but not in filesystem)
console.log('');
console.log('5. MISSING FILES CHECK:');
console.log('-'.repeat(80));
cameras.forEach(cam => {
    const segments = db.prepare(`
        SELECT id, filename, file_path, start_time
        FROM recording_segments 
        WHERE camera_id = ?
    `).all(cam.id);
    
    segments.forEach(seg => {
        if (!existsSync(seg.file_path)) {
            const age = Math.round((Date.now() - new Date(seg.start_time).getTime()) / 60000);
            console.log(`  ⚠️ Missing: ${seg.filename} (${age}min ago, in DB but file not found)`);
            console.log(`     Path: ${seg.file_path}`);
        }
    });
});

console.log('');
console.log('='.repeat(80));
console.log('DIAGNOSTIC COMPLETE');
console.log('='.repeat(80));

db.close();
