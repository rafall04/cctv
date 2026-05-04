/**
 * Purpose: Keep always-on internal CCTV streams prewarmed in MediaMTX without creating viewer sessions.
 * Caller: Backend startup and health/runtime maintenance flows that need low-latency local camera playback.
 * Deps: axios MediaMTX/HLS clients, backend config, internal ingest policy resolver.
 * MainFuncs: warmStream(), warmAllCameras(), stopWarming(), stopAll().
 * SideEffects: Sends MediaMTX/HLS trigger requests and owns stream warmup intervals.
 */

import axios from 'axios';
import { config } from '../config/config.js';
import { resolveInternalIngestPolicy } from '../utils/internalIngestPolicy.js';

class StreamWarmer {
    constructor() {
        this.warmStreams = new Map(); // pathName -> intervalId
        this.hlsBaseUrl = config.mediamtx?.hlsUrlInternal || 'http://localhost:8888';
        this.mediamtxApiUrl = config.mediamtx?.apiUrl || 'http://localhost:9997';
    }

    /**
     * Start warming a stream - keeps RTSP connection alive without creating viewer session
     */
    async warmStream(pathName) {
        if (this.warmStreams.has(pathName)) {
            return; // Already warming
        }

        console.log(`[StreamWarmer] Starting warm for ${pathName}`);

        // Initial trigger to start RTSP connection
        await this.triggerStream(pathName);

        // Keep stream alive by triggering every 30 seconds
        // This prevents sourceOnDemandCloseAfter from closing the connection
        // Reduced from 5s to 30s to lower CPU usage
        const intervalId = setInterval(async () => {
            await this.triggerStream(pathName);
        }, 30000);

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
     * Trigger stream to keep RTSP connection alive
     * Uses MediaMTX API first (no reader created), falls back to HEAD request
     */
    async triggerStream(pathName) {
        try {
            // Method 1: Check path via MediaMTX API - this doesn't create a reader
            // but triggers sourceOnDemand if the path is configured
            const response = await axios.get(
                `${this.mediamtxApiUrl}/v3/paths/get/${pathName}`,
                { timeout: 5000 }
            );
            
            // If path exists and source is ready, we're good
            if (response.data?.sourceReady) {
                return;
            }
            
            // If source not ready, try to trigger via HLS HEAD request
            await this.triggerViaHLS(pathName);
        } catch (error) {
            // Path might not exist or MediaMTX API error
            // Try HLS trigger as fallback
            if (error.response?.status === 404) {
                // Path doesn't exist in MediaMTX - skip
                return;
            }
            await this.triggerViaHLS(pathName);
        }
    }

    /**
     * Trigger stream via HLS HEAD request
     * HEAD request triggers sourceOnDemand but doesn't create persistent reader
     */
    async triggerViaHLS(pathName) {
        try {
            // Use HEAD request - triggers source but doesn't create reader session
            await axios.head(`${this.hlsBaseUrl}/${pathName}/index.m3u8`, {
                timeout: 15000
            });
        } catch (error) {
            // If HEAD not supported, use GET but it may create temporary reader
            if (error.response?.status === 405 || error.code === 'ERR_BAD_REQUEST') {
                try {
                    await axios.get(`${this.hlsBaseUrl}/${pathName}/index.m3u8`, {
                        timeout: 15000,
                        // Don't follow redirects, just trigger
                        maxRedirects: 0,
                        validateStatus: () => true
                    });
                } catch {
                    // Silent
                }
            }
            // Silent for other errors
        }
    }

    /**
     * Warm all enabled cameras with staggered start
     * @param {Array} cameras - Array of camera objects with id and stream_key
     */
    async warmAllCameras(cameras) {
        let warmed = 0;
        let skipped = 0;

        console.log(`[StreamWarmer] Evaluating ${cameras.length} camera streams for pre-warm...`);
        
        for (const camera of cameras) {
            const resolvedPolicy = resolveInternalIngestPolicy(camera, camera._areaPolicy || null);
            const pathName = camera.stream_key || `camera${camera.id}`;

            if (resolvedPolicy.mode !== 'always_on') {
                skipped++;
                this.stopWarming(pathName);
                continue;
            }
            
            this.warmStream(pathName);
            warmed++;
            
            await this.waitBetweenWarmStarts();
        }
        
        console.log(`[StreamWarmer] Pre-warm active for ${warmed} stream(s), skipped ${skipped} on-demand stream(s)`);
        return {
            total: cameras.length,
            warmed,
            skipped,
        };
    }

    async waitBetweenWarmStarts(delayMs = 5000) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
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
