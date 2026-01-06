/**
 * Camera Health Service
 * Monitors camera online/offline status via MediaMTX API
 * Updates database with status every 30-60 seconds
 */

import axios from 'axios';
import Database from 'better-sqlite3';
import { config } from '../config/config.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = config.database.path.startsWith('/') 
    ? config.database.path 
    : join(__dirname, '..', config.database.path);

const mediaMtxApiBaseUrl = 'http://localhost:9997/v3';

class CameraHealthService {
    constructor() {
        this.checkInterval = null;
        this.isRunning = false;
        this.lastCheck = null;
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
     * A path is considered "ready" if it has source ready or readers
     * @returns {Promise<Map<string, object>>} Map of path name to path info
     */
    async getActivePaths() {
        try {
            const response = await axios.get(`${mediaMtxApiBaseUrl}/paths/list`, { 
                timeout: 5000 
            });
            
            const pathMap = new Map();
            const items = response.data?.items || [];
            
            for (const item of items) {
                pathMap.set(item.name, {
                    name: item.name,
                    ready: item.ready || false,
                    sourceReady: item.sourceReady || false,
                    readers: item.readers?.length || 0,
                    // Consider online if source is ready OR has active readers
                    isOnline: item.sourceReady || (item.readers?.length > 0)
                });
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
            const db = new Database(dbPath);
            
            // Get all enabled cameras
            const cameras = db.prepare(`
                SELECT id, name, is_online 
                FROM cameras 
                WHERE enabled = 1
            `).all();

            const updateStmt = db.prepare(`
                UPDATE cameras 
                SET is_online = ?, last_online_check = datetime('now') 
                WHERE id = ?
            `);

            let onlineCount = 0;
            let offlineCount = 0;
            let changedCount = 0;

            for (const camera of cameras) {
                const pathName = `camera${camera.id}`;
                const pathInfo = activePaths.get(pathName);
                
                // Camera is online if:
                // 1. Path exists in MediaMTX AND
                // 2. Source is ready OR has active readers
                const isOnline = pathInfo?.isOnline ? 1 : 0;
                
                // Only update if status changed
                if (camera.is_online !== isOnline) {
                    updateStmt.run(isOnline, camera.id);
                    changedCount++;
                    
                    if (isOnline) {
                        console.log(`[CameraHealth] ${camera.name} is now ONLINE`);
                    } else {
                        console.log(`[CameraHealth] ${camera.name} is now OFFLINE`);
                    }
                }

                if (isOnline) {
                    onlineCount++;
                } else {
                    offlineCount++;
                }
            }

            db.close();
            this.lastCheck = new Date();

            // Only log if there were changes or periodically
            if (changedCount > 0) {
                console.log(`[CameraHealth] Status: ${onlineCount} online, ${offlineCount} offline (${changedCount} changed)`);
            }

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
            const db = new Database(dbPath, { readonly: true });
            
            const stats = db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN is_online = 1 THEN 1 ELSE 0 END) as online,
                    SUM(CASE WHEN is_online = 0 OR is_online IS NULL THEN 1 ELSE 0 END) as offline
                FROM cameras 
                WHERE enabled = 1
            `).get();

            db.close();

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
            const pathName = `camera${cameraId}`;
            const pathInfo = activePaths.get(pathName);
            
            const isOnline = pathInfo?.isOnline ? 1 : 0;
            
            // Update database
            const db = new Database(dbPath);
            db.prepare(`
                UPDATE cameras 
                SET is_online = ?, last_online_check = datetime('now') 
                WHERE id = ?
            `).run(isOnline, cameraId);
            db.close();

            return isOnline === 1;
        } catch (error) {
            console.error(`[CameraHealth] Check camera ${cameraId} failed:`, error.message);
            return false;
        }
    }
}

export default new CameraHealthService();
