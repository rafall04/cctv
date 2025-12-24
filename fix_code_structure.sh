#!/bin/bash
# A script to fix JavaScript module inconsistencies and API payloads.

# Stop all running PM2 processes to prevent conflicts.
echo "Stopping PM2 services..."
pm2 stop all
echo "PM2 services stopped."

# Overwrite the mediaMtxService.js file with a corrected version.
# This version uses ES Module syntax (import/export default) and removes the problematic 'sourceOnDemand' key.
echo "Applying fix to backend/services/mediaMtxService.js..."
cat > backend/services/mediaMtxService.js << 'EOF'
import axios from 'axios';
import Database from 'better-sqlite3';

// Configuration
const dbPath = './database/cctv.db';
const mediaMtxApiBaseUrl = 'http://localhost:9997/v3';

class MediaMtxService {
    /**
     * Fetches statistics from the MediaMTX API.
     * This was missing but is required by the admin dashboard.
     * @returns {Promise<any>}
     */
    async getStats() {
        try {
            const [pathsResponse, sessionsResponse] = await Promise.all([
                axios.get(`${mediaMtxApiBaseUrl}/paths/list`),
                axios.get(`${mediaMtxApiBaseUrl}/sessions/list`),
            ]);
            return {
                paths: pathsResponse.data?.items ? Object.values(pathsResponse.data.items) : [],
                sessions: sessionsResponse.data?.items ? Object.values(sessionsResponse.data.items) : [],
                error: false,
            };
        } catch (error) {
            if (error.code !== 'ECONNREFUSED') {
                console.error('[MediaMTX Service] Error fetching stats from MediaMTX:', error.message);
            }
            return { paths: [], sessions: [], error: true, message: error.message };
        }
    }

    /**
     * Fetches all active paths from the MediaMTX API.
     * @returns {Promise<string[]>} A list of path names.
     */
    async getMediaMtxPaths() {
        try {
            const response = await axios.get(`${mediaMtxApiBaseUrl}/paths/list`);
            return response.data?.items ? Object.keys(response.data.items) : [];
        } catch (error) {
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
    getDatabaseCameras() {
        try {
            const db = new Database(dbPath, { readonly: true });
            const stmt = db.prepare('SELECT id, name, private_rtsp_url AS rtsp_url, path_name FROM cameras WHERE enabled = 1');
            const cameras = stmt.all();
            db.close();
            return cameras;
        } catch (error) {
            console.error('[MediaMTX Service] Error fetching cameras from database:', error.message);
            return [];
        }
    }

    /**
     * Synchronizes camera configurations between the database and MediaMTX.
     */
    async syncCameras() {
        console.log('[MediaMTX Service] Starting camera synchronization...');
        const mediaMtxPaths = await this.getMediaMtxPaths();
        const dbCameras = this.getDatabaseCameras();
        const dbCameraPaths = new Set(dbCameras.map(cam => cam.path_name));

        const orphanedPaths = mediaMtxPaths.filter(path => path !== 'all_others' && !dbCameraPaths.has(path));
        if (orphanedPaths.length > 0) {
            console.log(`[MediaMTX Service] Removing ${orphanedPaths.length} orphaned paths.`);
            for (const pathName of orphanedPaths) {
                try {
                    await axios.post(`${mediaMtxApiBaseUrl}/config/paths/delete/${pathName}`);
                    console.log(`[MediaMTX Service]   - Removed orphan path: ${pathName}`);
                } catch (error) {
                    console.error(`[MediaMTX Service]   - Error removing orphan path ${pathName}:`, error.message);
                }
            }
        }

        if (dbCameras.length > 0) {
            console.log(`[MediaMTX Service] Syncing ${dbCameras.length} cameras from database...`);
            for (const camera of dbCameras) {
                if (!camera.path_name || !camera.rtsp_url) {
                    console.warn(`[MediaMTX Service]   - Skipping camera '${camera.name}' due to missing path or RTSP URL.`);
                    continue;
                }
                const pathConfig = { source: camera.rtsp_url };
                try {
                    await axios.post(`${mediaMtxApiBaseUrl}/config/paths/edit/${camera.path_name}`, pathConfig);
                    console.log(`[MediaMTX Service]   - Synced camera: ${camera.name} (${camera.path_name})`);
                } catch (error) {
                    console.error(`[MediaMTX Service]   - Error syncing camera ${camera.name}:`, error.message);
                }
            }
        }
        console.log('[MediaMTX Service] Synchronization complete.');
    }
}

export default new MediaMtxService();
EOF
echo "File 'backend/services/mediaMtxService.js' has been updated."

# Use sed to perform in-place replacement of import statements in controller files.
# This aligns them with the new default export from mediaMtxService.
echo "Updating controller imports..."
sed -i.bak "s/import { mediaMtxService } from '..\/services\/mediaMtxService.js';/import mediaMtxService from '..\/services\/mediaMtxService.js';/" backend/controllers/adminController.js
sed -i.bak "s/const mediaMtxService = require('..\/services\/mediaMtxService');/import mediaMtxService from '..\/services\/mediaMtxService.js';/" backend/controllers/cameraController.js
echo "Controller imports have been fixed."

# Remove the backup files created by sed.
echo "Cleaning up backup files..."
rm -f backend/controllers/*.js.bak
echo "Backup files removed."

# Restart all PM2 services to apply the changes.
echo "Restarting PM2 services..."
pm2 restart all
echo "PM2 services restarted."

# Display the latest logs from the backend to confirm it's running correctly.
echo "Tailing backend logs to verify fix..."
sleep 2 # Give the service a moment to log potential errors.
pm2 logs rafnet-cctv-backend --lines 20

echo "Script finished."
