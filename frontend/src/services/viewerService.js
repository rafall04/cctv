/**
 * Viewer Service
 * Handles viewer session tracking for CCTV streams
 * 
 * Supports multiple concurrent sessions (for multi-view)
 * 
 * Timing Configuration:
 * - Heartbeat interval: 5 seconds
 * - Backend timeout: 15 seconds
 * - This ensures sessions stay active with 3 heartbeats before timeout
 * 
 * Usage:
 * 1. Call startSession(cameraId) when user starts watching - returns sessionId
 * 2. Service automatically sends heartbeats every 5 seconds for all active sessions
 * 3. Call stopSession(sessionId) when user stops watching
 * 4. Call stopAllSessions() on component unmount
 */

import apiClient from './apiClient';

// Heartbeat interval in milliseconds
// Reduced from 10s to 5s for more reliable session tracking
const HEARTBEAT_INTERVAL = 5000; // 5 seconds

class ViewerService {
    constructor() {
        // Map of sessionId -> session data
        this.sessions = new Map();
        this.heartbeatInterval = null;
    }

    /**
     * Start a new viewer session for a camera
     * @param {number} cameraId - The camera being watched
     * @returns {Promise<string>} Session ID
     */
    async startSession(cameraId) {
        try {
            const response = await apiClient.post('/api/viewer/start', { cameraId });
            
            if (response.data.success) {
                const sessionId = response.data.data.sessionId;
                
                this.sessions.set(sessionId, {
                    sessionId,
                    cameraId,
                    startedAt: new Date()
                });

                // Start heartbeat if not already running
                this.ensureHeartbeat();

                console.log(`[ViewerService] Session started: ${sessionId} for camera ${cameraId}`);
                return sessionId;
            }
            
            throw new Error(response.data.message || 'Failed to start session');
        } catch (error) {
            console.error('[ViewerService] Error starting session:', error);
            throw error;
        }
    }

    /**
     * Send heartbeat for all active sessions
     */
    async sendHeartbeats() {
        if (this.sessions.size === 0) return;

        const promises = [];
        
        for (const [sessionId] of this.sessions) {
            promises.push(
                apiClient.post('/api/viewer/heartbeat', { sessionId })
                    .catch(error => {
                        console.error(`[ViewerService] Heartbeat failed for ${sessionId}:`, error.message);
                        // Don't remove session here, let server handle cleanup
                    })
            );
        }

        await Promise.allSettled(promises);
    }

    /**
     * Ensure heartbeat interval is running
     */
    ensureHeartbeat() {
        if (this.heartbeatInterval) return;
        
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeats();
        }, HEARTBEAT_INTERVAL);
    }

    /**
     * Stop heartbeat if no sessions
     */
    checkStopHeartbeat() {
        if (this.sessions.size === 0 && this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Stop a specific viewer session
     * @param {string} sessionId - Session ID to stop
     */
    async stopSession(sessionId) {
        if (!sessionId || !this.sessions.has(sessionId)) return;

        try {
            await apiClient.post('/api/viewer/stop', { sessionId });
            console.log(`[ViewerService] Session stopped: ${sessionId}`);
        } catch (error) {
            console.error('[ViewerService] Error stopping session:', error);
        } finally {
            this.sessions.delete(sessionId);
            this.checkStopHeartbeat();
        }
    }

    /**
     * Stop all active sessions
     */
    async stopAllSessions() {
        if (this.sessions.size === 0) return;

        const promises = [];
        
        for (const [sessionId] of this.sessions) {
            promises.push(
                apiClient.post('/api/viewer/stop', { sessionId })
                    .catch(error => {
                        console.error(`[ViewerService] Error stopping session ${sessionId}:`, error);
                    })
            );
        }

        await Promise.allSettled(promises);
        this.sessions.clear();
        this.checkStopHeartbeat();
        console.log('[ViewerService] All sessions stopped');
    }

    /**
     * Get session by ID
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    /**
     * Get all active sessions
     */
    getAllSessions() {
        return Array.from(this.sessions.values());
    }

    /**
     * Check if there are any active sessions
     */
    hasActiveSessions() {
        return this.sessions.size > 0;
    }

    /**
     * Get count of active sessions
     */
    getSessionCount() {
        return this.sessions.size;
    }
}

// Export singleton instance
export const viewerService = new ViewerService();

// Also export class for testing
export { ViewerService };

// Cleanup on page unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        if (viewerService.hasActiveSessions()) {
            // Use sendBeacon for reliable delivery on page unload
            for (const session of viewerService.getAllSessions()) {
                try {
                    const blob = new Blob([JSON.stringify({ sessionId: session.sessionId })], {
                        type: 'application/json'
                    });
                    navigator.sendBeacon('/api/viewer/stop', blob);
                } catch (e) {
                    // Ignore errors during unload
                }
            }
        }
    });

    // Also handle visibility change (tab hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && viewerService.hasActiveSessions()) {
            // Send heartbeat when tab becomes hidden to extend sessions
            viewerService.sendHeartbeats();
        }
    });
}
