#!/usr/bin/env node
/**
 * Force sync MediaMTX paths with database
 * Run: node backend/scripts/force-sync-mediamtx.js
 */

import mediaMtxService from '../services/mediaMtxService.js';

console.log('Starting MediaMTX force sync...');
console.log('');

try {
    // Get current state
    const cameras = mediaMtxService.getDatabaseCameras();
    console.log(`Found ${cameras.length} enabled cameras in database:`);
    cameras.forEach(cam => {
        console.log(`  - Camera ${cam.id}: ${cam.name}`);
        console.log(`    Path: ${cam.path_name}`);
        console.log(`    RTSP: ${cam.rtsp_url?.substring(0, 50)}...`);
    });
    console.log('');

    // Force sync
    console.log('Running force sync...');
    await mediaMtxService.syncCameras(3, true);
    
    console.log('');
    console.log('✅ Sync completed successfully!');
} catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
}
