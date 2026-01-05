/**
 * Stream Warmer Service
 * Keeps frequently viewed camera streams pre-loaded in MediaMTX
 * Only warms streams that are actually reachable
 */

import axios from 'axios';
import { config } from '../config/config.js';

class StreamWarmer {
    constructor() {
        this.warmStreams = new Map(); // pathName -> { intervalId, failCount }
        // Use INTERNAL URL for server-side requests
        this.hlsBaseUrl = config.mediamtx?.hlsUrlInternal || 'http://localhost:8888';
        this.mediamtxApiUrl = config.mediamtx?.apiUrl || 'http://localhost:9997';
        this.maxFailures = 3; // Stop warming after 3 consecutive failures
    }

    /**
     * Check if a stream is actually ready/online in MediaMTX
     */
    async isStreamReady(pathName) {
        try {
            const response = await axios.get(
                `${this.mediamtxApiUrl}/v3/paths/get/${pathName}`,
                { timeout: 3000 }
            );
            // Stream is ready if it has a source and is not in error state
            return response.data?.ready === true || response.data?.source !== null;
        } catch {
            return false;
        }
    }

    /**
     * Start warming a specific stream - only if it's reachable
     */
    async warmStream(pathName) {
        if (this.warmStreams.has(pathName)) {
            return; // Already warming
        }

        // First check if stream is reachable
        const isReady = await this.isStreamReady(pathName);
        if (!isReady) {
            // Try one fetch to trigger connection
            const success = await this.fetchPlaylist(pathName);
            if (!success) {
                console.log(`[StreamWarmer] ${pathName} not reachable, skipping`);
                return;
            }
        }

        console.log(`[StreamWarmer] Warming ${pathName}`);
        
        const streamInfo = { failCount: 0, intervalId: null };
        this.warmStreams.set(pathName, streamInfo);

        // Keep stream alive by fetching playlist every 8 seconds
        streamInfo.intervalId = setInterval(async () => {
            const info = this.warmStreams.get(pathName);
            if (!info) return;

            const success = await this.fetchPlaylist(pathName);
            
            if (!success) {
                info.failCount++;
                if (info.failCount >= this.maxFailures) {
                    console.log(`[StreamWarmer] ${pathName} offline, pausing warm`);
                    this.stopWarming(pathName);
                }
            } else {
                info.failCount = 0; // Reset on success
            }
        }, 8000);
    }

    /**
     * Stop warming a specific stream
     */
    stopWarming(pathName) {
        const info = this.warmStreams.get(pathName);
        if (info) {
            if (info.intervalId) {
                clearInterval(info.intervalId);
            }
            this.warmStreams.delete(pathName);
        }
    }

    /**
     * Fetch HLS playlist to keep stream active
     * Returns true if successful, false otherwise
     */
    async fetchPlaylist(pathName) {
        try {
            const response = await axios.get(`${this.hlsBaseUrl}/${pathName}/index.m3u8`, {
                timeout: 5000,
                validateStatus: (status) => status < 500
            });
            return response.status === 200;
        } catch {
            return false;
        }
    }

    /**
     * Warm all enabled cameras - only those that are reachable
     */
    async warmAllCameras(cameras) {
        let warmedCount = 0;
        
        for (const camera of cameras) {
            const pathName = `camera${camera.id}`;
            await this.warmStream(pathName);
            
            if (this.warmStreams.has(pathName)) {
                warmedCount++;
            }
            
            // Stagger to avoid overwhelming network
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`[StreamWarmer] ${warmedCount}/${cameras.length} streams warmed`);
    }

    /**
     * Stop all warming
     */
    stopAll() {
        for (const pathName of this.warmStreams.keys()) {
            this.stopWarming(pathName);
        }
        console.log('[StreamWarmer] All streams stopped');
    }

    /**
     * Get list of currently warmed streams
     */
    getWarmedStreams() {
        return Array.from(this.warmStreams.keys());
    }
}

export default new StreamWarmer();
