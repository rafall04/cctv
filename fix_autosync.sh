#!/bin/bash
# =================================================================
#
# Title: fix_autosync.sh
#
# Description: This script refactors the MediaMTX sync logic into
#              a reusable service and provides instructions for
#              integrating it into the backend.
#
# Actions:
#   1. Stops PM2.
#   2. Writes the new 'mediaMtxService.js' file.
#   3. Displays clear instructions for manual code edits.
#   4. Restarts PM2.
#
# Usage:
#   Run this script from the project root.
#   bash fix_autosync.sh
#
# =================================================================

set -e # Exit immediately if a command exits with a non-zero status.

# --- Script Start ---
echo "🚀 Starting Auto-Sync Refactor for RAF NET CCTV Hub..."

# 1. Stop all PM2 services
echo "🛑 Stopping all PM2 services..."
pm2 stop all || echo "PM2 not running."

# 2. Create the new MediaMtx Service File
echo "🔧 Creating the new MediaMTX Sync Service..."
mkdir -p backend/services
tee backend/services/mediaMtxService.js > /dev/null <<'EOF'
const Database = require('better-sqlite3');
const axios = require('axios');

// Configuration
const dbPath = './database/cctv.db';
const mediaMtxApiBaseUrl = 'http://localhost:9997/v3';

/**
 * Fetches all active paths from the MediaMTX API.
 * @returns {Promise<string[]>} A list of path names.
 */
async function getMediaMtxPaths() {
    try {
        const response = await axios.get(`${mediaMtxApiBaseUrl}/paths/list`);
        if (response.data && response.data.items) {
            return Object.keys(response.data.items);
        }
        return [];
    } catch (error) {
        console.error('[MediaMTX Service] Error fetching paths from MediaMTX:', error.message);
        return [];
    }
}

/**
 * Fetches all cameras from the application database.
 * @returns {any[]} A list of camera objects.
 */
function getDatabaseCameras() {
    try {
        const db = new Database(dbPath, { readonly: true });
        const stmt = db.prepare('SELECT * FROM cameras');
        const cameras = stmt.all();
        db.close();
        return cameras;
    } catch (error) {
        console.error('[MediaMTX Service] Error fetching cameras from database:', error.message);
        return [];
    }
}

/**
 * Synchronizes the camera configurations between the database and MediaMTX.
 * This includes adding/updating active cameras and removing orphaned paths.
 */
async function syncCameras() {
    console.log('[MediaMTX Service] Starting camera synchronization...');

    const mediaMtxPaths = await getMediaMtxPaths();
    const dbCameras = getDatabaseCameras();
    const dbCameraPaths = new Set(dbCameras.map(cam => cam.path_name));

    // 1. Identify and remove orphaned paths from MediaMTX
    const orphanedPaths = mediaMtxPaths.filter(path => !dbCameraPaths.has(path) && path !== 'all_others');

    if (orphanedPaths.length > 0) {
        console.log(`[MediaMTX Service] Found ${orphanedPaths.length} orphaned paths to remove.`);
        for (const pathName of orphanedPaths) {
            try {
                await axios.delete(`${mediaMtxApiBaseUrl}/config/paths/${pathName}`);
                console.log(`[MediaMTX Service]   - Successfully removed orphan path: ${pathName}`);
            } catch (error) {
                console.error(`[MediaMTX Service]   - Error removing orphan path ${pathName}:`, error.message);
            }
        }
    } else {
        console.log('[MediaMTX Service] No orphaned paths found.');
    }

    // 2. Add or update paths from the database
    if (dbCameras.length > 0) {
        console.log(`[MediaMTX Service] Syncing ${dbCameras.length} cameras from database...`);
        for (const camera of dbCameras) {
            const pathConfig = {
                source: camera.rtsp_url,
                sourceOnDemand: true,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '10s',
                runOnDemandRestart: true,
            };

            try {
                await axios.patch(`${mediaMtxApiBaseUrl}/config/paths/${camera.path_name}`, pathConfig);
                console.log(`[MediaMTX Service]   - Successfully synced camera: ${camera.name} (${camera.path_name})`);
            } catch (error) {
                console.error(`[MediaMTX Service]   - Error syncing camera ${camera.name}:`, error.message);
            }
        }
    } else {
        console.log('[MediaMTX Service] No cameras in database to sync.');
    }

    console.log('[MediaMTX Service] Synchronization complete.');
}

module.exports = {
    syncCameras,
};
EOF
echo "  ✅ 'backend/services/mediaMtxService.js' created successfully."

# 3. Display Manual Instructions
echo ""
echo "------------------------------------------------------------------"
echo "⚠️ ACTION REQUIRED: Please manually edit the following files."
echo "------------------------------------------------------------------"
echo ""
echo "1. Edit 'backend/controllers/cameraController.js':"

echo "   a) Add this import at the top:"
echo "      const mediaMtxService = require('../services/mediaMtxService');"

echo "   b) Add this line after the database query in 'addCamera', 'updateCamera', and 'deleteCamera':"
echo "      mediaMtxService.syncCameras();"

echo "      Example for 'addCamera':"
echo "      ..."
echo "      res.status(201).json({ message: 'Camera added successfully' });"
echo "      mediaMtxService.syncCameras(); // <-- ADD HERE"
echo "      ..."

echo "------------------------------------------------------------------"
echo ""
echo "2. Edit 'backend/server.js':"

echo "   a) Add this import at the top:"
echo "      const mediaMtxService = require('./services/mediaMtxService');"

echo "   b) Add this call inside the 'app.listen' callback:"
echo "      mediaMtxService.syncCameras();"

echo "      Example:"
echo "      ..."
echo "      app.listen(port, () => {"
echo "        console.log(\\