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
    constructor() {
        this.isOnline = false;
        this.lastSyncTime = 0;
        this.syncInterval = null;
        this.healthCheckInterval = null;
        this.consecutiveFailures = 0;
        this.maxConsecutiveFailures = 3;
    }

    /**
     * Start the auto-sync and health check mechanism
     */
    startAutoSync() {
        // Health check every 30 seconds
        this.healthCheckInterval = setInterval(async () => {
            await this.healthCheck();
        }, 30000);

        // Initial health check after 5 seconds
        setTimeout(() => this.healthCheck(), 5000);
        
        console.log('[MediaMTX] Auto-sync enabled (health check every 30s)');
    }

    /**
     * Stop the auto-sync mechanism
     */
    stopAutoSync() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Health check - verify MediaMTX is online and paths are synced
     * Only syncs when necessary to avoid interrupting active streams
     */
    async healthCheck() {
        try {
            const status = await this.getStatus();
            
            if (!status.online) {
                // MediaMTX is offline
                if (this.isOnline) {
                    console.log('[MediaMTX] Connection lost - waiting for reconnect...');
                }
                this.isOnline = false;
                this.consecutiveFailures++;
                return;
            }

            // MediaMTX is online
            const wasOffline = !this.isOnline;
            this.isOnline = true;
            this.consecutiveFailures = 0;

            // Only sync if we just came back online
            if (wasOffline) {
                console.log('[MediaMTX] Connection restored - syncing cameras...');
                await this.syncCameras(1);
                return;
            }

            // Check if paths need re-sync (only if paths are completely missing)
            const configPaths = await this.getConfiguredPaths();
            const dbCameras = this.getDatabaseCameras();
            
            // Count how many DB cameras have their path configured
            const configuredCameraCount = dbCameras.filter(cam => 
                configPaths.includes(cam.path_name)
            ).length;
            
            // Only sync if NO cameras are configured (complete loss)
            // Don't sync if some cameras are missing - that's handled by camera CRUD operations
            if (dbCameras.length > 0 && configuredCameraCount === 0) {
                console.log('[MediaMTX] All paths missing - re-syncing cameras...');
                await this.syncCameras(1);
            }
        } catch (error) {
            this.consecutiveFailures++;
            if (this.consecutiveFailures <= this.maxConsecutiveFailures) {
                console.error('[MediaMTX] Health check error:', error.message);
            }
        }
    }

    /**
     * Get list of configured path names from MediaMTX config
     * @returns {Promise<string[]>}
     */
    async getConfiguredPaths() {
        try {
            const response = await axios.get(`${mediaMtxApiBaseUrl}/config/paths/list`, { timeout: 5000 });
            const items = response.data?.items || [];
            return items.map(item => item.name);
        } catch {
            return [];
        }
    }

    /**
     * Fetches all active paths from the MediaMTX API.
     * @returns {Promise<string[]>} A list of path names.
     */
    async getMediaMtxPaths() {
        try {
            const response = await axios.get(`${mediaMtxApiBaseUrl}/paths/list`, { timeout: 5000 });
            if (response.data && response.data.items) {
                return response.data.items.map(item => item.name);
            }
            return [];
        } catch (error) {
            if (error.code !== 'ECONNREFUSED' && error.code !== 'ETIMEDOUT') {
                console.error('[MediaMTX Service] Error fetching paths:', error.message);
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
     * Uses paths/list endpoint to avoid error logs in MediaMTX
     * @param {string} pathName - The path name to check
     */
    async pathExists(pathName) {
        try {
            const paths = await this.getMediaMtxPaths();
            return paths.includes(pathName);
        } catch {
            return false;
        }
    }

    /**
     * Check if a path config exists in MediaMTX
     * Uses config/paths/list endpoint to avoid error logs
     * @param {string} pathName - The path name to check
     */
    async pathConfigExists(pathName) {
        try {
            const response = await axios.get(`${mediaMtxApiBaseUrl}/config/paths/list`, { timeout: 5000 });
            const items = response.data?.items || [];
            return items.some(item => item.name === pathName);
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
            // Check if path config exists using list endpoint (avoids error logs)
            const exists = await this.pathConfigExists(pathName);
            
            if (exists) {
                // Path exists, update it
                await axios.patch(`${mediaMtxApiBaseUrl}/config/paths/patch/${pathName}`, pathConfig, { timeout: 5000 });
                return { success: true, action: 'updated' };
            } else {
                // Path doesn't exist, add it
                await axios.post(`${mediaMtxApiBaseUrl}/config/paths/add/${pathName}`, pathConfig, { timeout: 5000 });
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
            await axios.delete(`${mediaMtxApiBaseUrl}/config/paths/delete/${pathName}`, { timeout: 5000 });
            return { success: true };
        } catch (error) {
            console.error(`[MediaMTX Service] Error removing path ${pathName}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Synchronizes the camera configurations between the database and MediaMTX.
     * Only adds missing paths and removes orphaned ones - doesn't update existing paths
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

        const configuredPaths = await this.getConfiguredPaths();
        const dbCameras = this.getDatabaseCameras();
        const dbCameraPaths = new Set(dbCameras.map(cam => cam.path_name));

        // Remove orphaned camera paths (paths in MediaMTX but not in DB)
        const systemPaths = ['all', 'all_others', 'health'];
        const orphanedPaths = configuredPaths.filter(path => 
            !dbCameraPaths.has(path) && 
            !systemPaths.includes(path) &&
            path.startsWith('camera')
        );

        for (const pathName of orphanedPaths) {
            await this.removePath(pathName);
        }

        // Only add paths that don't exist yet (don't update existing ones)
        const configuredPathsSet = new Set(configuredPaths);
        let added = 0;
        
        for (const camera of dbCameras) {
            if (!camera.path_name || !camera.rtsp_url?.startsWith('rtsp://')) continue;
            
            // Skip if path already exists - don't update to avoid stream interruption
            if (configuredPathsSet.has(camera.path_name)) continue;

            const pathConfig = {
                source: camera.rtsp_url,
                sourceProtocol: 'tcp',
                sourceOnDemand: true,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '30s',
            };

            try {
                await axios.post(`${mediaMtxApiBaseUrl}/config/paths/add/${camera.path_name}`, pathConfig, { timeout: 5000 });
                added++;
            } catch (error) {
                // Path might already exist, ignore
            }
        }

        if (added > 0 || orphanedPaths.length > 0) {
            console.log(`[MediaMTX] Sync complete: +${added} added, -${orphanedPaths.length} removed`);
        }
    }

    /**
     * Force update a specific camera path in MediaMTX
     * Called when camera RTSP URL is changed
     * @param {number} cameraId - The camera ID
     * @param {string} rtspUrl - The new RTSP URL
     */
    async updateCameraPath(cameraId, rtspUrl) {
        const pathName = `camera${cameraId}`;
        const pathConfig = {
            source: rtspUrl,
            sourceProtocol: 'tcp',
            sourceOnDemand: true,
            sourceOnDemandStartTimeout: '10s',
            sourceOnDemandCloseAfter: '30s',
        };

        try {
            const exists = await this.pathConfigExists(pathName);
            if (exists) {
                await axios.patch(`${mediaMtxApiBaseUrl}/config/paths/patch/${pathName}`, pathConfig, { timeout: 5000 });
            } else {
                await axios.post(`${mediaMtxApiBaseUrl}/config/paths/add/${pathName}`, pathConfig, { timeout: 5000 });
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove a specific camera path from MediaMTX
     * @param {number} cameraId - The camera ID
     */
    async removeCameraPath(cameraId) {
        return this.removePath(`camera${cameraId}`);
    }

    /**
     * Fetches statistics from the MediaMTX API.
     * @returns {Promise<any>}
     */
    async getStats() {
        try {
            const [pathsRes, configRes] = await Promise.all([
                axios.get(`${mediaMtxApiBaseUrl}/paths/list`, { timeout: 5000 }),
                axios.get(`${mediaMtxApiBaseUrl}/config/global/get`, { timeout: 5000 }),
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
            if (error.code !== 'ECONNREFUSED' && error.code !== 'ETIMEDOUT') {
                console.error('[MediaMTX Service] Error fetching stats:', error.message);
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
            const response = await axios.get(`${mediaMtxApiBaseUrl}/config/global/get`, { timeout: 5000 });
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
