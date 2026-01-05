/**
 * Stream Warmer Service
 * Keeps camera streams pre-loaded in MediaMTX for instant playback
 * by periodically requesting HLS playlists to keep RTSP connections alive
 */

import axios from 'axios';
import { config } from '../config/config.js';

class StreamWarmer {
    constructor() {
        this.warmStreams = new Map(); // pathName -> intervalId
        this.hlsBaseUrl = config.mediamtx?.hlsUrlInternal || 'http://localhost:8888';
        this.mediamtxApiUrl = config.mediamtx?.apiUrl || 'http://localhost:9997';
    }

    /**
     * Start warming a stream - keeps fetching playlist to maintain RTSP connection
     */
    async warmStream(pathName) {
        if (this.warmStreams.has(pathName)) {
            return; // Already warming
        }

        console.log(`[StreamWarmer] Starting warm for ${pathName}`);

        // Initial fetch to trigger RTSP connection
        await this.fetchPlaylist(pathName);

        // Keep stream alive by fetching playlist every 5 seconds
        // This prevents sourceOnDemandCloseAfter from closing the connection
        const intervalId = setInterval(async () => {
            await this.fetchPlaylist(pathName);
        }, 5000);

        this.warmStreams.set(pathName, intervalId);
    }

    /**
     * Stop warming a specific stream
     */
    stopWarming(pathName) {
        const intervalId = this.warmStreams.get(pathName);
        if (intervalId) {
            clearInterval(intervalId);
            this.warmStreams.delete(pathName);
            console.log(`[StreamWarmer] Stopped warming ${pathName}`);
        }
    }

    /**
     * Fetch HLS playlist to trigger/maintain RTSP connection
     */
    async fetchPlaylist(pathName) {
        try {
            await axios.get(`${this.hlsBaseUrl}/${pathName}/index.m3u8`, {
                timeout: 15000 // 15s timeout for initial connection
            });
        } catch (error) {
            // Silent - stream might not be ready yet or camera offline
        }
    }

    /**
     * Warm all enabled cameras with staggered start
     */
    async warmAllCameras(cameras) {
        console.log(`[StreamWarmer] Pre-warming ${cameras.length} camera streams...`);
        
        for (const camera of cameras) {
            const pathName = `camera${camera.id}`;
            
            // Start warming without waiting for result
            this.warmStream(pathName);
            
            // Stagger by 2 seconds to avoid overwhelming cameras
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        console.log(`[StreamWarmer] All streams warming started`);
    }

    /**
     * Stop all warming
     */
    stopAll() {
        for (const [pathName, intervalId] of this.warmStreams) {
            clearInterval(intervalId);
        }
        this.warmStreams.clear();
        console.log('[StreamWarmer] All streams stopped');
    }

    /**
     * Get list of currently warmed streams
     */
    getWarmedStreams() {
        return Array.from(this.warmStreams.keys());
    }

    /**
     * Check if a stream is being warmed
     */
    isWarming(pathName) {
        return this.warmStreams.has(pathName);
    }
}

export default new StreamWarmer();
