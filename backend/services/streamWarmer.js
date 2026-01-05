/**
 * Stream Warmer Service
 * Keeps frequently viewed camera streams pre-loaded in MediaMTX
 * to eliminate initial loading delay
 */

import axios from 'axios';
import { config } from '../config/config.js';

class StreamWarmer {
    constructor() {
        this.warmStreams = new Map(); // pathName -> AbortController
        this.hlsBaseUrl = config.mediamtx?.hlsUrl || 'http://localhost:8888';
        this.checkInterval = null;
    }

    /**
     * Start warming a specific stream by periodically fetching HLS playlist
     * This keeps MediaMTX connected to the camera
     */
    async warmStream(pathName) {
        if (this.warmStreams.has(pathName)) {
            return; // Already warming
        }

        const controller = new AbortController();
        this.warmStreams.set(pathName, controller);

        console.log(`[StreamWarmer] Starting warm for ${pathName}`);

        // Initial fetch to trigger stream connection
        await this.fetchPlaylist(pathName);

        // Keep stream alive by fetching playlist every 5 seconds
        const intervalId = setInterval(async () => {
            if (!this.warmStreams.has(pathName)) {
                clearInterval(intervalId);
                return;
            }
            await this.fetchPlaylist(pathName);
        }, 5000);

        // Store interval ID for cleanup
        controller.intervalId = intervalId;
    }

    /**
     * Stop warming a specific stream
     */
    stopWarming(pathName) {
        const controller = this.warmStreams.get(pathName);
        if (controller) {
            if (controller.intervalId) {
                clearInterval(controller.intervalId);
            }
            controller.abort();
            this.warmStreams.delete(pathName);
            console.log(`[StreamWarmer] Stopped warming ${pathName}`);
        }
    }

    /**
     * Fetch HLS playlist to keep stream active
     */
    async fetchPlaylist(pathName) {
        try {
            await axios.get(`${this.hlsBaseUrl}/${pathName}/index.m3u8`, {
                timeout: 8000,
                validateStatus: () => true // Don't throw on any status
            });
        } catch (error) {
            // Silent fail - stream might not be ready yet
        }
    }

    /**
     * Warm all enabled cameras
     */
    async warmAllCameras(cameras) {
        for (const camera of cameras) {
            const pathName = `camera${camera.id}`;
            await this.warmStream(pathName);
            // Stagger initialization to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    /**
     * Stop all warming
     */
    stopAll() {
        for (const pathName of this.warmStreams.keys()) {
            this.stopWarming(pathName);
        }
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
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
