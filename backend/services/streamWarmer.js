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
        // Source of truth for "which cameras should be warm", injected at startup so reconcile()
        // can self-fetch without importing the DB layer (avoids an import cycle with mediaMtxService).
        this.cameraProvider = null;
        this.reconcileTimer = null; // debounce handle for scheduleReconcile()
    }

    /** MediaMTX path name for a camera (matches mediaMtxService path naming). */
    pathNameFor(camera) {
        return camera.stream_key || `camera${camera.id}`;
    }

    /** True when the camera's resolved internal ingest policy is always_on (i.e. should be kept warm). */
    shouldWarm(camera) {
        return resolveInternalIngestPolicy(camera, camera._areaPolicy || null).mode === 'always_on';
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

        // Re-warm every 10s. This is now load-bearing (hlsAlwaysRemux:no): the HLS muxer closes
        // after idle, so we must re-touch it well within that window to keep always_on cameras at
        // instant TTFF. Cheap — one HEAD per warmed path per cycle, straight to MediaMTX.
        const intervalId = setInterval(async () => {
            await this.triggerStream(pathName);
        }, 10000);

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
        // Keep the HLS MUXER warm, not just the source. Under hlsAlwaysRemux:no the muxer is
        // created lazily and closes after idle, so we must touch the HLS endpoint every cycle to
        // keep segments ready for instant first-viewer TTFF on always_on (priority/local) cameras.
        try {
            // Path-existence check only: skip paths MediaMTX doesn't know (404).
            // Do NOT early-return on sourceReady — a ready SOURCE is not a warm MUXER.
            await axios.get(
                `${this.mediamtxApiUrl}/v3/paths/get/${pathName}`,
                { timeout: 5000 }
            );
        } catch (error) {
            if (error.response?.status === 404) {
                // Path not configured in MediaMTX - nothing to warm.
                return;
            }
            // Other MediaMTX API errors: still attempt to warm the muxer below.
        }

        // Touch the HLS endpoint to create/keep the muxer warm. Hits MediaMTX directly (:8888),
        // NOT the backend proxy, so this does NOT create or inflate a viewer session.
        await this.triggerViaHLS(pathName);
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
            const pathName = this.pathNameFor(camera);

            if (!this.shouldWarm(camera)) {
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

    /**
     * Reconcile the warm set against the current desired state (idempotent).
     *
     * Unlike warmAllCameras() — a one-shot startup pass over a snapshot — this also STOPS warming
     * paths that are no longer eligible: camera deleted, disabled, flipped to on_demand, moved to an
     * on_demand area, or whose stream_key changed. That makes it safe to run on every camera/area
     * mutation and on a periodic timer, and it is a no-op when nothing changed.
     *
     * This is the piece that keeps cameras created/edited AFTER backend startup warm without a
     * restart — warmAllCameras() only ever saw the boot-time camera list, so a camera added later was
     * never warmed (its HLS muxer stayed cold under hlsAlwaysRemux:no → slow first-viewer TTFF).
     *
     * @param {Array} cameras - enabled internal cameras (e.g. mediaMtxService.getDatabaseCameras()).
     */
    async reconcile(cameras = []) {
        const desired = new Set();
        for (const camera of cameras) {
            if (this.shouldWarm(camera)) {
                desired.add(this.pathNameFor(camera));
            }
        }

        // Stop paths that should no longer be warm (deleted / disabled / flipped to on_demand /
        // re-keyed). warmAllCameras never did this for cameras absent from its list, leaking intervals.
        let stopped = 0;
        for (const pathName of [...this.warmStreams.keys()]) {
            if (!desired.has(pathName)) {
                this.stopWarming(pathName);
                stopped++;
            }
        }

        // Start newly-eligible paths. Stagger only the genuinely new starts (steady state adds none,
        // so a periodic reconcile is effectively free).
        let started = 0;
        for (const pathName of desired) {
            if (!this.warmStreams.has(pathName)) {
                await this.warmStream(pathName);
                started++;
                await this.waitBetweenWarmStarts();
            }
        }

        if (started > 0 || stopped > 0) {
            console.log(`[StreamWarmer] Reconcile: +${started} started, -${stopped} stopped (${desired.size} always_on)`);
        }

        return { desired: desired.size, started, stopped };
    }

    /**
     * Inject the source of truth for the desired warm set (set once at startup). Keeps this service
     * DB-agnostic so it does not import mediaMtxService (which would create an import cycle).
     */
    setCameraProvider(fn) {
        this.cameraProvider = typeof fn === 'function' ? fn : null;
    }

    /**
     * Debounced reconcile trigger for camera/area mutations. Coalesces bursts (bulk edits, rapid
     * saves) into a single reconcile shortly after the last change, so toggling always_on/on_demand
     * takes effect within ~1.5s instead of waiting for the periodic pass. No-op until a provider is set.
     */
    scheduleReconcile(delayMs = 1500) {
        if (!this.cameraProvider) {
            return;
        }
        if (this.reconcileTimer) {
            clearTimeout(this.reconcileTimer);
        }
        this.reconcileTimer = setTimeout(() => {
            this.reconcileTimer = null;
            Promise.resolve()
                .then(() => this.reconcile(this.cameraProvider() || []))
                .catch((error) => console.error('[StreamWarmer] Reconcile failed:', error.message));
        }, delayMs);
    }

    async waitBetweenWarmStarts(delayMs = 5000) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    /**
     * Stop all warming
     */
    stopAll() {
        if (this.reconcileTimer) {
            clearTimeout(this.reconcileTimer);
            this.reconcileTimer = null;
        }
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
