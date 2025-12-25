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
     * Check if a path exists in MediaMTX
     * @param {string} pathName - The path name to check
     */
    async pathExists(pathName) {
        try {
            await axios.get(`${mediaMtxApiBaseUrl}/config/paths/get/${pathName}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Add or update a path in MediaMTX configuration
     * @param {string} pathName - The path name (e.g., 'camera1')
     * @param {object} pathConfig - The path configuration
     */
    async addOrUpdatePath(pathName, pathConfig) {
        try {
            // Check if path exists first to avoid error logs
            const exists = await this.pathExists(pathName);
            
            if (exists) {
                // Path exists, update it
                await axios.patch(`${mediaMtxApiBaseUrl}/config/paths/patch/${pathName}`, pathConfig);
                return { success: true, action: 'updated' };
            } else {
                // Path doesn't exist, add it
                await axios.post(`${mediaMtxApiBaseUrl}/config/paths/add/${pathName}`, pathConfig);
                return { success: true, action: 'added' };
            }
        } catch (error) {
            // Silent fail for common errors
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
     * @param {number} retries - Number of retries if MediaMTX is not ready
     */
    async syncCameras(retries = 5) {
        // Check if MediaMTX is ready
        const status = await this.getStatus();
        if (!status.online) {
            if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                return this.syncCameras(retries - 1);
            }
            return;
        }

        const mediaMtxPaths = await this.getMediaMtxPaths();
        const dbCameras = this.getDatabaseCameras();
        const dbCameraPaths = new Set(dbCameras.map(cam => cam.path_name));

        // Remove orphaned camera paths
        const systemPaths = ['all', 'all_others', 'health'];
        const orphanedPaths = mediaMtxPaths.filter(path => 
            !dbCameraPaths.has(path) && 
            !systemPaths.includes(path) &&
            path.startsWith('camera')
        );

        for (const pathName of orphanedPaths) {
            await this.removePath(pathName);
        }

        // Sync cameras from database
        let synced = 0;
        for (const camera of dbCameras) {
            if (!camera.path_name || !camera.rtsp_url?.startsWith('rtsp://')) continue;

            const pathConfig = {
                source: camera.rtsp_url,
                sourceProtocol: 'tcp',
                sourceOnDemand: true,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '10s',
            };

            const result = await this.addOrUpdatePath(camera.path_name, pathConfig);
            if (result.success) synced++;
        }

        console.log(`[MediaMTX] Synced ${synced}/${dbCameras.length} cameras`);
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
