import apiClient from './apiClient';

const HEARTBEAT_INTERVAL = 5000;

class PlaybackViewerService {
    constructor() {
        this.sessions = new Map();
        this.heartbeatInterval = null;
    }

    async startSession({ cameraId, segmentFilename, segmentStartedAt = null, accessMode = 'public_preview' }) {
        try {
            const response = await apiClient.post('/api/playback-viewer/start', {
                cameraId,
                segmentFilename,
                segmentStartedAt,
                accessMode,
            });

            if (!response.data?.success) {
                throw new Error(response.data?.message || 'Failed to start playback viewer session');
            }

            const sessionId = response.data.data.sessionId;
            const sessionKey = `${cameraId}:${segmentFilename}:${accessMode}`;
            this.sessions.set(sessionId, {
                sessionId,
                sessionKey,
                cameraId,
                segmentFilename,
                accessMode,
            });
            this.ensureHeartbeat();
            return sessionId;
        } catch (error) {
            const statusCode = error?.response?.status || null;
            if (statusCode && statusCode < 500) {
                console.warn('[PlaybackViewerService] Session tracking unavailable', statusCode);
                return null;
            }

            console.error('[PlaybackViewerService] Error starting session:', error);
            return null;
        }
    }

    async sendHeartbeats() {
        if (this.sessions.size === 0) {
            return;
        }

        const promises = [];
        for (const [sessionId] of this.sessions) {
            promises.push(
                apiClient.post('/api/playback-viewer/heartbeat', { sessionId }).catch((error) => {
                    console.error(`[PlaybackViewerService] Heartbeat failed for ${sessionId}:`, error.message);
                })
            );
        }

        await Promise.allSettled(promises);
    }

    ensureHeartbeat() {
        if (this.heartbeatInterval) {
            return;
        }

        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeats();
        }, HEARTBEAT_INTERVAL);
    }

    checkStopHeartbeat() {
        if (this.sessions.size === 0 && this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    async stopSession(sessionId) {
        if (!sessionId || !this.sessions.has(sessionId)) {
            return;
        }

        try {
            await apiClient.post('/api/playback-viewer/stop', { sessionId });
        } catch (error) {
            console.error('[PlaybackViewerService] Error stopping session:', error);
        } finally {
            this.sessions.delete(sessionId);
            this.checkStopHeartbeat();
        }
    }

    async stopAllSessions() {
        if (this.sessions.size === 0) {
            return;
        }

        const stopPromises = [];
        for (const [sessionId] of this.sessions) {
            stopPromises.push(
                apiClient.post('/api/playback-viewer/stop', { sessionId }).catch((error) => {
                    console.error(`[PlaybackViewerService] Error stopping session ${sessionId}:`, error);
                })
            );
        }

        await Promise.allSettled(stopPromises);
        this.sessions.clear();
        this.checkStopHeartbeat();
    }
}

export const playbackViewerService = new PlaybackViewerService();

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        if (playbackViewerService.sessions.size === 0) {
            return;
        }

        for (const session of playbackViewerService.sessions.values()) {
            try {
                const blob = new Blob([JSON.stringify({ sessionId: session.sessionId })], {
                    type: 'application/json',
                });
                navigator.sendBeacon('/api/playback-viewer/stop', blob);
            } catch (error) {
                // Ignore unload delivery errors
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && playbackViewerService.sessions.size > 0) {
            playbackViewerService.sendHeartbeats();
        }
    });
}

export default playbackViewerService;
