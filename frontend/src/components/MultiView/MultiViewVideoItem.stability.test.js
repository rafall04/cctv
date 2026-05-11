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
});
