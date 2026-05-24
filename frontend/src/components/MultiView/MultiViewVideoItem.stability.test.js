/*
Purpose: Guard the multi-view player against lifecycle regressions that cause intermittent stream errors.
Caller: Vitest frontend component stability suite.
Deps: Node fs/path/url, MultiViewVideoItem source.
MainFuncs: MultiViewVideoItem source stability tests.
SideEffects: Reads component source from disk.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(dirname, 'MultiViewVideoItem.jsx'), 'utf8');
const layoutSource = fs.readFileSync(path.join(dirname, 'MultiViewLayout.jsx'), 'utf8');

function getHlsEffectDependencies() {
    const start = source.indexOf('        initStream();');
    const dependencyStart = source.indexOf('    }, [', start);
    const dependencyEnd = source.indexOf('    ]);', dependencyStart);

    return source.slice(dependencyStart, dependencyEnd);
}

function getSourceBlock(startPattern, endPattern) {
    const start = source.indexOf(startPattern);
    const end = source.indexOf(endPattern, start);

    return source.slice(start, end);
}

describe('MultiViewVideoItem HLS stability', () => {
    it('does not restart the HLS effect from transient loading state changes', () => {
        const dependencies = getHlsEffectDependencies();

        expect(dependencies).not.toContain('loadingStage');
        expect(dependencies).not.toContain('autoRetryCount');
    });

    it('does not read stream timeout callbacks before their hook declaration', () => {
        const firstClearTimeoutDependency = source.indexOf('[clearStreamTimeout]');
        const streamTimeoutDeclaration = source.indexOf('clearTimeout: clearStreamTimeout');

        expect(firstClearTimeoutDependency).toBeGreaterThan(streamTimeoutDeclaration);
    });

    it('guards delayed viewer session startup so unmounted tiles do not leak sessions', () => {
        expect(source).toContain('viewerSessionActiveRef.current = true;');
        expect(source).toContain('!viewerSessionActiveRef.current');
        expect(source).toContain('viewerSessionActiveRef.current = false;');
        expect(source).toContain('viewerSessionRunRef.current');
    });

    it('retries internal HLS manifest warmup errors before surfacing tile failure', () => {
        expect(source).toContain('internalWarmupRetryCountRef');
        expect(source).toContain('manifestLoadError');
        expect(source).toContain('levelLoadError');
        expect(source).toContain('setRetryKey((current) => current + 1)');
    });

    it('routes non-HLS formats outside the HLS effect', () => {
        expect(source).toContain("renderMode !== 'hls'");
        expect(source).toContain("renderMode === 'flv'");
        expect(source).toContain("renderMode === 'mjpeg'");
        expect(source).toContain("renderMode === 'embed'");
    });

    it('cleans up FLV player instances on tile unmount', () => {
        expect(source).toContain('flvRef.current.destroy()');
        expect(source).toContain('flvRef.current = null');
    });

    it('does not silently stay connecting when no stream URL exists', () => {
        expect(source).toContain('Stream URL belum tersedia untuk Multi-View');
        expect(source).toContain('Format stream tidak didukung');
    });

    it('renders the multi-view shell above public mobile dock overlays', () => {
        expect(layoutSource).toContain('z-[1300]');
    });

    it('starts frontend viewer sessions only after playback is confirmed', () => {
        const handlePlayingIndex = source.indexOf('const handlePlaying = () => {');
        const handlePlayingEnd = source.indexOf('        };', handlePlayingIndex);
        const handlePlayingBlock = source.slice(handlePlayingIndex, handlePlayingEnd);

        expect(source).toContain('startViewerSessionAfterPlayback');
        expect(handlePlayingBlock).toContain('startViewerSessionAfterPlayback();');
    });

    it('skips frontend viewer sessions for backend-proxied HLS streams', () => {
        expect(source).toContain('shouldTrackFrontendViewerSession');
        expect(source).toContain('return false;');
        expect(source).toContain('isDirectStream');
    });

    it('hides the base status badge while fullscreen controls render their own badge', () => {
        const statusBadgeBlock = getSourceBlock(
            '{/* Status badge - disable pulse animation in fullscreen and on low-end devices */}',
            '<button onClick={handleClose}'
        );

        expect(statusBadgeBlock).toContain("isFullscreen ? 'hidden' : ''");
    });

    it('keeps fullscreen camera title compact and bounded', () => {
        const fullscreenTopBarBlock = getSourceBlock(
            '{/* Top bar with camera name and exit - Always visible */}',
            '{/* Bottom controls - Always visible on mobile */}'
        );

        expect(fullscreenTopBarBlock).toContain('text-xs');
        expect(fullscreenTopBarBlock).toContain('truncate');
        expect(fullscreenTopBarBlock).toContain('max-w-');
    });

    it('cancels the snapshot toast timer on unmount to avoid stale setState', () => {
        // Without this guard, closing the tile within 3s of a snapshot
        // would log the React "Can't update state on unmounted component"
        // warning and leak the timer.
        expect(source).toContain('snapshotTimerRef');
        expect(source).toContain('clearTimeout(snapshotTimerRef.current)');
    });

    it('watchdogs MJPEG / embed first-frame load so a silent upstream surfaces an error', () => {
        // <img>/<iframe> onLoad only fires once; if the upstream never
        // delivers a single frame we'd otherwise sit on the spinner
        // forever. The watchdog flips the tile to error after a bounded
        // window so the user gets retry buttons.
        expect(source).toContain('initLoadTimeoutRef');
        expect(source).toContain('MJPEG_EMBED_LOAD_TIMEOUT_MS');
    });

    it('snaps the player back to the live edge when an external tile drifts too far behind', () => {
        // Background-tab / mobile-suspend can leave a player tens of
        // seconds behind real-time. We mirror VideoPopup's snap-to-live
        // recovery so multi-view doesn't accumulate stale buffer either.
        expect(source).toContain('LIVE_EDGE_LATENCY_SNAP_S');
        expect(source).toContain('liveSyncPosition');
        expect(source).toContain("addEventListener('play', handlePlaySync)");
    });

    it('sandboxes the external embed iframe to limit damage from a hostile upstream', () => {
        // allow-scripts + allow-same-origin are required for most player
        // pages; the absence of allow-top-navigation prevents a hijacked
        // embed from yanking the parent window away from the public site.
        expect(source).toContain('sandbox="allow-scripts allow-same-origin');
    });

    it('reflects server-side maintenance / offline flips back into the tile status', () => {
        // useState's initialiser only runs once; without this effect the
        // tile would keep claiming LIVE after the camera flipped to
        // maintenance mid-session.
        expect(source).toContain("setStatus('maintenance')");
        expect(source).toContain("setStatus('offline')");
        expect(source).toContain('[isMaintenance, isOffline]');
    });

    it('memoises the component so a sibling tile re-render does not destroy this tile\'s HLS', () => {
        // memo() depends on the parent passing stable callbacks +
        // a stable camera reference. The parent (MultiViewLayout) was
        // updated in the same change-set to pass onRemove directly
        // instead of wrapping it in a per-tile arrow.
        expect(source).toContain('export default memo(MultiViewVideoItem)');
        expect(layoutSource).not.toContain('onRemove={() => onRemove(');
        expect(layoutSource).toContain('onRemove={onRemove}');
    });

    it('uses an imperative ref for zoom controls instead of reaching into wrapper DOM children', () => {
        // The legacy getZoomableWrapper() pattern relied on
        // wrapperRef.current.firstElementChild, which silently breaks any
        // time the tile DOM gets an extra wrapping element (error
        // boundary, theme provider, etc.). useImperativeHandle keeps the
        // contract explicit.
        expect(source).toContain('zoomableRef');
        expect(source).not.toContain('getZoomableWrapper()');
    });
});
