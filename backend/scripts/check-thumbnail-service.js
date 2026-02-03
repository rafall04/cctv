#!/usr/bin/env node
/**
 * Diagnostic script untuk thumbnail service
 * Run: node backend/scripts/check-thumbnail-service.js
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { query } from '../database/database.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔍 Thumbnail Service Diagnostic\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// 1. Check FFmpeg
console.log('\n1️⃣  Checking FFmpeg...');
try {
    const { stdout } = await execAsync('ffmpeg -version', { timeout: 3000 });
    const version = stdout.split('\n')[0];
    console.log(`   ✅ FFmpeg installed: ${version}`);
} catch (error) {
    console.log('   ❌ FFmpeg NOT found');
    console.log('   Install: sudo apt install ffmpeg -y');
    process.exit(1);
}

// 2. Check MediaMTX
console.log('\n2️⃣  Checking MediaMTX...');
try {
    const { stdout } = await execAsync('curl -s http://localhost:9997/v3/config/global/get', { timeout: 3000 });
    const config = JSON.parse(stdout);
    console.log(`   ✅ MediaMTX online (API: ${config.api ? 'enabled' : 'disabled'})`);
} catch (error) {
    console.log('   ❌ MediaMTX offline or not responding');
    console.log('   Check: pm2 status | grep mediamtx');
}

// 3. Check HLS endpoint
console.log('\n3️⃣  Checking HLS endpoint...');
try {
    await execAsync('curl -s -I http://localhost:8888/', { timeout: 3000 });
    console.log('   ✅ HLS server responding on port 8888');
} catch (error) {
    console.log('   ❌ HLS server not responding');
}

// 4. Check database cameras
console.log('\n4️⃣  Checking cameras in database...');
const cameras = query('SELECT id, name, stream_key, enabled, thumbnail_path, thumbnail_updated_at FROM cameras WHERE enabled = 1');
console.log(`   Found ${cameras.length} enabled cameras:`);
cameras.forEach(cam => {
    const hasThumb = cam.thumbnail_path ? '✅' : '❌';
    const lastUpdate = cam.thumbnail_updated_at || 'never';
    console.log(`   ${hasThumb} Camera ${cam.id}: ${cam.name}`);
    console.log(`      Stream: ${cam.stream_key}`);
    console.log(`      Thumbnail: ${cam.thumbnail_path || 'not generated'}`);
    console.log(`      Updated: ${lastUpdate}`);
});

// 5. Check thumbnail directory
console.log('\n5️⃣  Checking thumbnail directory...');
const thumbDir = join(__dirname, '..', 'data', 'thumbnails');
if (existsSync(thumbDir)) {
    console.log(`   ✅ Directory exists: ${thumbDir}`);
    try {
        const { stdout } = await execAsync(`ls -lh ${thumbDir}`);
        const files = stdout.trim().split('\n').filter(line => line.includes('.jpg'));
        console.log(`   Found ${files.length} thumbnail files:`);
        files.forEach(file => console.log(`      ${file}`));
    } catch (error) {
        console.log('   No files in directory');
    }
} else {
    console.log(`   ❌ Directory not found: ${thumbDir}`);
}

// 6. Test thumbnail generation for first camera
if (cameras.length > 0) {
    const testCam = cameras[0];
    console.log(`\n6️⃣  Testing thumbnail generation for camera ${testCam.id}...`);
    
    const hlsUrl = `http://localhost:8888/${testCam.stream_key}/index.m3u8`;
    const outputPath = join(thumbDir, `test_${testCam.id}.jpg`);
    
    // Check if HLS stream is accessible
    console.log(`   Checking HLS stream: ${hlsUrl}`);
    try {
        await execAsync(`curl -s -I "${hlsUrl}"`, { timeout: 3000 });
        console.log('   ✅ HLS stream accessible');
        
        // Try to generate thumbnail
        console.log('   Attempting to generate thumbnail...');
        const command = `ffmpeg -i "${hlsUrl}" -vframes 1 -s 320x180 -q:v 8 "${outputPath}" -y`;
        await execAsync(command, { timeout: 10000 });
        
        if (existsSync(outputPath)) {
            const { stdout } = await execAsync(`ls -lh "${outputPath}"`);
            console.log(`   ✅ Thumbnail generated: ${stdout.trim()}`);
            
            // Cleanup test file
            await execAsync(`rm "${outputPath}"`);
        } else {
            console.log('   ❌ Thumbnail file not created');
        }
    } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        if (error.message.includes('404')) {
            console.log('   → HLS stream not found (camera may be offline)');
        } else if (error.message.includes('Connection refused')) {
            console.log('   → MediaMTX not running');
        }
    }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\n📋 Recommendations:');
console.log('   1. Ensure MediaMTX is running: pm2 status');
console.log('   2. Check backend logs: pm2 logs rafnet-cctv-backend | grep Thumbnail');
console.log('   3. Manually trigger generation: pm2 restart rafnet-cctv-backend');
console.log('   4. Wait 10 seconds after restart for initial generation');
console.log('\n');
