import axios from 'axios';
import { config } from '../config/config.js';
import { query, queryOne, execute } from '../database/connectionPool.js';
import { 
    sendCameraOfflineNotification, 
    sendCameraOnlineNotification,
    isTelegramConfigured 
} from './telegramService.js';
import { getTimezone } from './timezoneService.js';

const mediaMtxApiBaseUrl = 'http://localhost:9997/v3';

/**
 * Get current timestamp in configured timezone format for SQLite
 */
function getTimestamp() {
    const timezone = getTimezone();
    return new Date().toLocaleString('sv-SE', { 
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(' ', ' ');
}

class CameraHealthService {
    constructor() {
        this.checkInterval = null;
        this.isRunning = false;
        this.lastCheck = null;
        // Track when cameras went offline for grace period (cameraId -> timestamp)
        this.offlineSince = new Map(); 
        // Grace period in milliseconds (45 seconds)
        this.offlineGracePeriodMs = 45000;
    }

    /**
     * Start the health check service
     * @param {number} intervalMs - Check interval in milliseconds (default: 30000 = 30s)
     */
    start(intervalMs = 30000) {
        if (this.isRunning) {
            console.log('[CameraHealth] Service already running');
            return;
        }

        this.isRunning = true;
        console.log(`[CameraHealth] Starting health check service (interval: ${intervalMs/1000}s)`);

        // Initial check after 10 seconds (give MediaMTX time to start)
        setTimeout(() => this.checkAllCameras(), 10000);

        // Regular interval checks
        this.checkInterval = setInterval(() => {
            this.checkAllCameras();
        }, intervalMs);
    }

    /**
     * Stop the health check service
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isRunning = false;
        console.log('[CameraHealth] Service stopped');
    }

    /**
     * Get active paths from MediaMTX
     * A path is considered "configured" if it exists in MediaMTX config
     * A path is "streaming" if source is ready or has readers
     * @returns {Promise<Map<string, object>>} Map of path name to path info
     */
    async getActivePaths() {
        try {
            // Get configured paths from config (not just active paths)
            const configResponse = await axios.get(`${mediaMtxApiBaseUrl}/config/paths/list`, { 
                timeout: 5000 
            });
            
            const pathMap = new Map();
            const configItems = configResponse.data?.items || [];
            
            // First, mark all configured paths as "online" (path exists = camera configured)
            for (const item of configItems) {
                pathMap.set(item.name, {
                    name: item.name,
                    configured: true,
                    ready: false,
                    sourceReady: false,
                    readers: 0,
                    // Camera is online if it's configured in MediaMTX
                    // (sourceOnDemand means source won't be ready until someone watches)
                    isOnline: true
                });
            }
            
            // Then get active paths to check if they're actually streaming
            try {
                const pathsResponse = await axios.get(`${mediaMtxApiBaseUrl}/paths/list`, { 
                    timeout: 5000 
                });
                const activeItems = pathsResponse.data?.items || [];
                
                for (const item of activeItems) {
                    if (pathMap.has(item.name)) {
                        const existing = pathMap.get(item.name);
                        existing.ready = item.ready || false;
                        existing.sourceReady = item.sourceReady || false;
                        existing.readers = item.readers?.length || 0;
                    }
                }
            } catch (e) {
                // Paths list might fail if no active streams, that's OK
            }
            
            return pathMap;
        } catch (error) {
            // MediaMTX might be offline
            console.error('[CameraHealth] Failed to get paths:', error.message);
            return new Map();
        }
    }

    /**
     * Check all cameras and update their online status
     */
    async checkAllCameras() {
        try {
            const activePaths = await this.getActivePaths();
            
            // Get all enabled cameras (include stream_key for path lookup)
            // Use connection pool for better performance
            const cameras = query(`
                SELECT id, name, location, is_online, stream_key 
                FROM cameras 
                WHERE enabled = 1
            `);

            // Debug: log what paths we found
            console.log(`[CameraHealth] Found ${activePaths.size} configured paths in MediaMTX`);

            const timestamp = getTimestamp();

            let onlineCount = 0;
            let offlineCount = 0;
            let changedCount = 0;

            for (const camera of cameras) {
                // Use stream_key if available, fallback to legacy camera{id} format
                const pathName = camera.stream_key || `camera${camera.id}`;
                const pathInfo = activePaths.get(pathName);
                
                // Debug: log path lookup
                if (!pathInfo) {
                    console.log(`[CameraHealth] Camera ${camera.id} (${camera.name}): path "${pathName}" NOT found in MediaMTX`);
                }
                
                // Camera is online if:
                // 1. Path exists in MediaMTX config (configured = online)
                const isOnline = pathInfo?.isOnline ? 1 : 0;
                
                if (isOnline) {
                    // CAMERA IS ONLINE (MediaMTX says so)
                    
                    // If it was marked offline in the DATABASE, bring it back online
                    if (camera.is_online === 0) {
                        execute(
                            'UPDATE cameras SET is_online = 1, last_online_check = ? WHERE id = ?',
                            [timestamp, camera.id]
                        );
                        changedCount++;

                        console.log(`[CameraHealth] ${camera.name} is now ONLINE`);

                        if (isTelegramConfigured()) {
                            // Calculate downtime if we have a record
                            let downtime = null;
                            if (this.offlineSince.has(camera.id)) {
                                downtime = Math.floor((Date.now() - this.offlineSince.get(camera.id)) / 1000);
                            }

                            sendCameraOnlineNotification({
                                id: camera.id,
                                name: camera.name,
                                location: camera.location
                            }, downtime).catch(err => {
                                console.error('[CameraHealth] Failed to send online notification:', err.message);
                            });
                        }
                    }

                    // Always clear the grace period tracking when online
                    if (this.offlineSince.has(camera.id)) {
                        this.offlineSince.delete(camera.id);
                    }
                } else {
                    // CAMERA IS OFFLINE (MediaMTX says so)
                    
                    // If it's already marked offline in DB, keep it that way
                    if (camera.is_online === 0) {
                        // Already confirmed offline, do nothing
                    } else {
                        // It's marked ONLINE in DB, but MediaMTX says OFFLINE
                        
                        // Start or check grace period
                        if (!this.offlineSince.has(camera.id)) {
                            // First time we see it offline, record the time
                            this.offlineSince.set(camera.id, Date.now());
                            console.log(`[CameraHealth] ${camera.name} offline detected, starting ${this.offlineGracePeriodMs/1000}s grace period`);
                        } else {
                            // Already in grace period, check if it's expired
                            const offlineDuration = Date.now() - this.offlineSince.get(camera.id);
                            
                            if (offlineDuration >= this.offlineGracePeriodMs) {
                                // Grace period expired! Mark as officially offline in DB
                                execute(
                                    'UPDATE cameras SET is_online = 0, last_online_check = ? WHERE id = ?',
                                    [timestamp, camera.id]
                                );
                                changedCount++;
                                
                                console.log(`[CameraHealth] ${camera.name} is now OFFLINE (Grace period of ${Math.floor(offlineDuration/1000)}s expired)`);

                                if (isTelegramConfigured()) {
                                    sendCameraOfflineNotification({
                                        id: camera.id,
                                        name: camera.name,
                                        location: camera.location
                                    }).catch(err => {
                                        console.error('[CameraHealth] Failed to send offline notification:', err.message);
                                    });
                                }
                                // Note: we keep this.offlineSince entry to calculate downtime later when it recovers
                            } else {
                                // Still in grace period
                                console.log(`[CameraHealth] ${camera.name} still in grace period (${Math.floor(offlineDuration/1000)}s / ${this.offlineGracePeriodMs/1000}s)`);
                            }
                        }
                    }
                }

                if (isOnline) {
                    onlineCount++;
                } else {
                    offlineCount++;
                }
            }

            this.lastCheck = new Date();

            // Always log status for debugging
            console.log(`[CameraHealth] Check complete: ${onlineCount} online, ${offlineCount} offline (${changedCount} changed)`);

        } catch (error) {
            console.error('[CameraHealth] Check failed:', error.message);
        }
    }

    /**
     * Get current health status summary
     * @returns {Promise<object>}
     */
    async getStatus() {
        try {
            // Use connection pool for better performance
            const stats = queryOne(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN is_online = 1 THEN 1 ELSE 0 END) as online,
                    SUM(CASE WHEN is_online = 0 OR is_online IS NULL THEN 1 ELSE 0 END) as offline
                FROM cameras 
                WHERE enabled = 1
            `);

            return {
                total: stats.total || 0,
                online: stats.online || 0,
                offline: stats.offline || 0,
                lastCheck: this.lastCheck,
                isRunning: this.isRunning
            };
        } catch (error) {
            return {
                total: 0,
                online: 0,
                offline: 0,
                lastCheck: this.lastCheck,
                isRunning: this.isRunning,
                error: error.message
            };
        }
    }

    /**
     * Force check a specific camera
     * @param {number} cameraId 
     * @returns {Promise<boolean>} true if online
     */
    async checkCamera(cameraId) {
        try {
            const activePaths = await this.getActivePaths();
            
            // Get camera's stream_key from database using connection pool
            const camera = queryOne('SELECT stream_key FROM cameras WHERE id = ?', [cameraId]);
            
            // Use stream_key if available, fallback to legacy format
            const pathName = camera?.stream_key || `camera${cameraId}`;
            const pathInfo = activePaths.get(pathName);
            
            const isOnline = pathInfo?.isOnline ? 1 : 0;
            
            // Update database with configured timezone timestamp
            const timestamp = getTimestamp();
            execute(
                'UPDATE cameras SET is_online = ?, last_online_check = ? WHERE id = ?',
                [isOnline, timestamp, cameraId]
            );

            return isOnline === 1;
        } catch (error) {
            console.error(`[CameraHealth] Check camera ${cameraId} failed:`, error.message);
            return false;
        }
    }
}

export default new CameraHealthService();
