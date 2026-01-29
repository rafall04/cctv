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
            // Use stream_key as path_name for security (unpredictable URLs)
            // Fallback to 'camera' + id if stream_key is not set
            const stmt = db.prepare(`
                SELECT 
                    id, 
                    name, 
                    private_rtsp_url as rtsp_url,
                    stream_key,
                    COALESCE(stream_key, 'camera' || id) as path_name 
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
     * Get current path configuration from MediaMTX
     * @param {string} pathName - The path name to get config for
     * @returns {Promise<object|null>}
     */
    async getPathConfig(pathName) {
        try {
            const response = await axios.get(`${mediaMtxApiBaseUrl}/config/paths/get/${pathName}`, { timeout: 5000 });
            return response.data;
        } catch {
            return null;
        }
    }

    /**
     * Synchronizes the camera configurations between the database and MediaMTX.
     * Adds missing paths, updates paths with wrong source, and removes orphaned ones.
     * @param {number} retries - Number of retries if MediaMTX is not ready
     * @param {boolean} forceUpdate - Force update all paths even if they exist
     */
    async syncCameras(retries = 5, forceUpdate = false) {
        const status = await this.getStatus();
        if (!status.online) {
            if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                return this.syncCameras(retries - 1, forceUpdate);
            }
            console.log('[MediaMTX] Sync failed - MediaMTX is offline');
            return;
        }

        const configuredPaths = await this.getConfiguredPaths();
        const dbCameras = this.getDatabaseCameras();
        const dbCameraPaths = new Set(dbCameras.map(cam => cam.path_name));

        // Remove orphaned paths (not in database)
        const systemPaths = ['all', 'all_others', 'health'];
        const orphanedPaths = configuredPaths.filter(path => {
            if (systemPaths.includes(path)) return false;
            return !dbCameraPaths.has(path);
        });

        for (const pathName of orphanedPaths) {
            await this.removePath(pathName);
            console.log(`[MediaMTX] Removed orphaned path: ${pathName}`);
        }

        // Add or update paths
        const configuredPathsSet = new Set(configuredPaths);
        let added = 0;
        let updated = 0;
        
        for (const camera of dbCameras) {
            if (!camera.path_name || !camera.rtsp_url?.startsWith('rtsp://')) {
                console.log(`[MediaMTX] Skipping camera ${camera.id}: invalid path_name or rtsp_url`);
                continue;
            }

            const pathConfig = {
                source: camera.rtsp_url,
                sourceProtocol: 'tcp',
                sourceOnDemand: true,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '30s',
            };

            try {
                if (!configuredPathsSet.has(camera.path_name)) {
                    await axios.post(`${mediaMtxApiBaseUrl}/config/paths/add/${camera.path_name}`, pathConfig, { timeout: 5000 });
                    console.log(`[MediaMTX] Added path: ${camera.path_name}`);
                    added++;
                } else if (forceUpdate) {
                    const currentConfig = await this.getPathConfig(camera.path_name);
                    if (currentConfig && currentConfig.source !== camera.rtsp_url) {
                        await axios.patch(`${mediaMtxApiBaseUrl}/config/paths/patch/${camera.path_name}`, pathConfig, { timeout: 5000 });
                        console.log(`[MediaMTX] Updated path: ${camera.path_name}`);
                        updated++;
                    }
                }
            } catch (error) {
                console.error(`[MediaMTX] Error syncing path ${camera.path_name}:`, error.message);
            }
        }

        if (added > 0 || updated > 0 || orphanedPaths.length > 0) {
            console.log(`[MediaMTX] Sync complete: +${added} added, ~${updated} updated, -${orphanedPaths.length} removed`);
        }
    }

    /**
     * Force update a specific camera path in MediaMTX
     * Called when camera RTSP URL is changed or camera is created/enabled
     * @param {string} streamKey - The stream key (UUID) for the camera path
     * @param {string} rtspUrl - The RTSP URL
     * @returns {Promise<object>}
     */
    async updateCameraPath(streamKey, rtspUrl) {
        const pathName = streamKey;
        
        // Validate inputs
        if (!streamKey) {
            console.error(`[MediaMTX] Missing stream key`);
            return { success: false, error: 'Missing stream key' };
        }
        
        if (!rtspUrl || !rtspUrl.startsWith('rtsp://')) {
            console.error(`[MediaMTX] Invalid RTSP URL for ${pathName}: ${rtspUrl}`);
            return { success: false, error: 'Invalid RTSP URL' };
        }

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
                // Check if source is different before updating
                const currentConfig = await this.getPathConfig(pathName);
                if (currentConfig && currentConfig.source === rtspUrl) {
                    console.log(`[MediaMTX] Path ${pathName} already has correct source, skipping update`);
                    return { success: true, action: 'unchanged' };
                }
                
                await axios.patch(`${mediaMtxApiBaseUrl}/config/paths/patch/${pathName}`, pathConfig, { timeout: 5000 });
                console.log(`[MediaMTX] Updated path: ${pathName}`);
                return { success: true, action: 'updated' };
            } else {
                await axios.post(`${mediaMtxApiBaseUrl}/config/paths/add/${pathName}`, pathConfig, { timeout: 5000 });
                console.log(`[MediaMTX] Added path: ${pathName}`);
                return { success: true, action: 'added' };
            }
        } catch (error) {
            console.error(`[MediaMTX] Error updating path ${pathName}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove a specific camera path from MediaMTX by stream key
     * @param {string} streamKey - The stream key (UUID) to remove
     */
    async removeCameraPathByKey(streamKey) {
        if (!streamKey) return { success: false, error: 'Missing stream key' };
        return this.removePath(streamKey);
    }

    /**
     * Fetches statistics from the MediaMTX API.
     * Filters out internal preload readers (from localhost) to show only real viewers.
     * @returns {Promise<any>}
     */
    async getStats(debug = false) {
        try {
            const [pathsRes, configRes] = await Promise.all([
                axios.get(`${mediaMtxApiBaseUrl}/paths/list`, { timeout: 5000 }),
                axios.get(`${mediaMtxApiBaseUrl}/config/global/get`, { timeout: 5000 }),
            ]);
            
            // Get sessions/readers count from paths data
            const paths = pathsRes.data?.items || [];
            const sessions = [];
            
            // Filter function to exclude internal/preload readers
            // Real viewers have remoteAddr populated, internal muxers don't
            const isRealViewer = (reader) => {
                // hlsMuxer without remoteAddr is internal (from preload/warming service)
                // Real HLS viewers have remoteAddr populated
                if (reader.type === 'hlsMuxer' && !reader.remoteAddr) {
                    if (debug) {
                        console.log(`[MediaMTX] Filtered out internal hlsMuxer (no remoteAddr)`);
                    }
                    return false;
                }
                
                // Check remoteAddr if available - filter localhost
                if (reader.remoteAddr) {
                    const addr = reader.remoteAddr.toLowerCase();
                    // Exclude localhost readers (these are from preload/warming service)
                    // Handle various formats: 127.0.0.1, localhost, ::1, ::ffff:127.0.0.1
                    if (
                        addr.includes('127.0.0.1') || 
                        addr.includes('localhost') || 
                        addr.startsWith('[::1]') ||
                        addr.includes('::1]') ||
                        addr === '::1' ||
                        addr.includes('::ffff:127.0.0.1')
                    ) {
                        if (debug) {
                            console.log(`[MediaMTX] Filtered out localhost reader: ${addr}`);
                        }
                        return false;
                    }
                }
                
                // Also check id field which may contain IP info in some MediaMTX versions
                if (reader.id) {
                    const id = reader.id.toLowerCase();
                    if (
                        id.includes('127.0.0.1') || 
                        id.includes('localhost') ||
                        id.includes('::1')
                    ) {
                        if (debug) {
                            console.log(`[MediaMTX] Filtered out localhost reader by id: ${id}`);
                        }
                        return false;
                    }
                }
                
                return true;
            };
            
            // Process paths and filter readers
            const processedPaths = paths.map(path => {
                const realReaders = (path.readers || []).filter(isRealViewer);
                return {
                    ...path,
                    readers: realReaders,
                    _originalReaderCount: (path.readers || []).length,
                    _filteredReaderCount: realReaders.length
                };
            });
            
            // Extract real readers from each path as sessions
            processedPaths.forEach(path => {
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
                paths: processedPaths,
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
