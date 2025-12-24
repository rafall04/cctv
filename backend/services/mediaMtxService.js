import axios from 'axios';
import Database from 'better-sqlite3';
import { config } from '../config/config.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration - use same path resolution as database.js
const dbPath = config.database.path.startsWith('/') 
  ? config.database.path 
  : join(__dirname, '..', config.database.path);
const mediaMtxApiBaseUrl = 'http://localhost:9997/v3';

class MediaMtxService {
    /**
     * Fetches all active paths from the MediaMTX API.
     * @returns {Promise<string[]>} A list of path names.
     */
    async getMediaMtxPaths() {
        try {
            const response = await axios.get(`${mediaMtxApiBaseUrl}/paths/list`);
            if (response.data && response.data.items) {
                // items is an array of path objects with 'name' property
                return response.data.items.map(item => item.name);
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
    getDatabaseCameras() {
        try {
            const db = new Database(dbPath, { readonly: true });
            // Use correct column name: private_rtsp_url instead of rtsp_url
            // Generate path_name from camera id if not exists
            const stmt = db.prepare(`
                SELECT 
                    id, 
                    name, 
                    private_rtsp_url as rtsp_url, 
                    'camera' || id as path_name 
                FROM cameras 
                WHERE enabled = 1
            `);
            const cameras = stmt.all();
            db.close();
            return cameras;
        } catch (error) {
            console.error('[MediaMTX Service] Error fetching cameras from database:', error.message);
            return [];
        }
    }

    /**
     * Add or update a path in MediaMTX configuration
     * @param {string} pathName - The path name (e.g., 'camera1')
     * @param {object} pathConfig - The path configuration
     */
    async addOrUpdatePath(pathName, pathConfig) {
        try {
            // First try to add the path
            await axios.post(`${mediaMtxApiBaseUrl}/config/paths/add/${pathName}`, pathConfig);
            return { success: true, action: 'added' };
        } catch (error) {
            if (error.response && error.response.status === 400) {
                // Path already exists, try to patch/update it
                try {
                    await axios.patch(`${mediaMtxApiBaseUrl}/config/paths/patch/${pathName}`, pathConfig);
                    return { success: true, action: 'updated' };
                } catch (patchError) {
                    console.error(`[MediaMTX Service] Error patching path ${pathName}:`, patchError.message);
                    return { success: false, error: patchError.message };
                }
            }
            console.error(`[MediaMTX Service] Error adding path ${pathName}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove a path from MediaMTX configuration
     * @param {string} pathName - The path name to remove
     */
    async removePath(pathName) {
        try {
            await axios.delete(`${mediaMtxApiBaseUrl}/config/paths/delete/${pathName}`);
            return { success: true };
        } catch (error) {
            console.error(`[MediaMTX Service] Error removing path ${pathName}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Synchronizes the camera configurations between the database and MediaMTX.
     * This includes adding/updating active cameras and removing orphaned paths.
     */
    async syncCameras() {
        console.log('[MediaMTX Service] Starting camera synchronization...');

        const mediaMtxPaths = await this.getMediaMtxPaths();
        const dbCameras = this.getDatabaseCameras();
        const dbCameraPaths = new Set(dbCameras.map(cam => cam.path_name));

        // 1. Identify and remove orphaned paths from MediaMTX
        // Skip system paths like 'all', 'all_others', etc.
        const systemPaths = ['all', 'all_others', 'health'];
        const orphanedPaths = mediaMtxPaths.filter(path => 
            !dbCameraPaths.has(path) && 
            !systemPaths.includes(path) &&
            path.startsWith('camera')
        );

        if (orphanedPaths.length > 0) {
            console.log(`[MediaMTX Service] Found ${orphanedPaths.length} orphaned paths to remove.`);
            for (const pathName of orphanedPaths) {
                const result = await this.removePath(pathName);
                if (result.success) {
                    console.log(`[MediaMTX Service]   - Successfully removed orphan path: ${pathName}`);
                } else {
                    console.error(`[MediaMTX Service]   - Error removing orphan path ${pathName}:`, result.error);
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

                // Validate RTSP URL
                if (!camera.rtsp_url || !camera.rtsp_url.startsWith('rtsp://')) {
                    console.warn(`[MediaMTX Service]   - Skipping camera '${camera.name}' due to invalid RTSP URL.`);
                    continue;
                }

                const pathConfig = {
                    source: 'publisher',
                    runOnDemand: `ffmpeg -rtsp_transport tcp -i ${camera.rtsp_url} -c:v libx264 -preset ultrafast -tune zerolatency -b:v 2M -c:a aac -f rtsp rtsp://localhost:8554/${camera.path_name}`,
                    runOnDemandRestart: true,
                    runOnDemandStartTimeout: '30s',
                    runOnDemandCloseAfter: '30s',
                };

                const result = await this.addOrUpdatePath(camera.path_name, pathConfig);
                if (result.success) {
                    console.log(`[MediaMTX Service]   - Successfully ${result.action} camera: ${camera.name} (${camera.path_name})`);
                } else {
                    console.error(`[MediaMTX Service]   - Error syncing camera ${camera.name}:`, result.error);
                }
            }
        } else {
            console.log('[MediaMTX Service] No enabled cameras in database to sync.');
        }

        console.log('[MediaMTX Service] Synchronization complete.');
    }

    /**
     * Fetches statistics from the MediaMTX API.
     * @returns {Promise<any>}
     */
    async getStats() {
        try {
            const [pathsRes, configRes] = await Promise.all([
                axios.get(`${mediaMtxApiBaseUrl}/paths/list`),
                axios.get(`${mediaMtxApiBaseUrl}/config/global/get`),
            ]);
            
            // Get sessions/readers count from paths data
            const paths = pathsRes.data?.items || [];
            const sessions = [];
            
            // Extract readers from each path as sessions
            paths.forEach(path => {
                if (path.readers && path.readers.length > 0) {
                    path.readers.forEach(reader => {
                        sessions.push({
                            path: path.name,
                            type: reader.type,
                            id: reader.id
                        });
                    });
                }
            });
            
            return {
                paths: paths,
                sessions: sessions,
                config: configRes.data || {},
                error: false
            };
        } catch (error) {
            if (error.code !== 'ECONNREFUSED') {
                console.error('[MediaMTX Service] Error fetching stats from MediaMTX:', error.message);
            }
            return {
                paths: [],
                sessions: [],
                config: {},
                error: true,
                message: error.message
            };
        }
    }

    /**
     * Get MediaMTX server status
     * @returns {Promise<object>}
     */
    async getStatus() {
        try {
            const response = await axios.get(`${mediaMtxApiBaseUrl}/config/global/get`);
            return {
                online: true,
                config: response.data
            };
        } catch (error) {
            return {
                online: false,
                error: error.message
            };
        }
    }
}

export default new MediaMtxService();
