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
        // Don't throw if MediaMTX is not ready, just log it.
        if (error.code !== 'ECONNREFUSED') {
            console.error('[MediaMTX Service] Error fetching paths from MediaMTX:', error.message);
        }
        return [];
    }
}

/**
 * Fetches all enabled cameras from the application database.
 * @returns {any[]} A list of camera objects.
 */
function getDatabaseCameras() {
    try {
        const db = new Database(dbPath, { readonly: true });
        const stmt = db.prepare('SELECT id, name, rtsp_url, path_name FROM cameras WHERE enabled = 1');
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
                await axios.post(`${mediaMtxApiBaseUrl}/config/paths/delete/${pathName}`);
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
            // Ensure path_name is not null or empty
            if (!camera.path_name) {
                console.warn(`[MediaMTX Service]   - Skipping camera '${camera.name}' due to empty path_name.`);
                continue;
            }

            const pathConfig = {
                source: camera.rtsp_url,
                sourceOnDemand: true,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '10s',
            };

            try {
                // Use POST to add/replace the configuration
                await axios.post(`${mediaMtxApiBaseUrl}/config/paths/edit/${camera.path_name}`, pathConfig);
                console.log(`[MediaMTX Service]   - Successfully synced camera: ${camera.name} (${camera.path_name})`);
            } catch (error) {
                console.error(`[MediaMTX Service]   - Error syncing camera ${camera.name}:`, error.message);
            }
        }
    } else {
        console.log('[MediaMTX Service] No enabled cameras in database to sync.');
    }

    console.log('[MediaMTX Service] Synchronization complete.');
}

module.exports = {
    syncCameras,
};