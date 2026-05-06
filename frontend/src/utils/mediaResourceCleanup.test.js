// @vitest-environment jsdom

/*
 * Purpose: Verify shared media resource cleanup for public live video surfaces.
 * Caller: Frontend focused media lifecycle test gate.
 * Deps: Vitest, mediaResourceCleanup.
 * MainFuncs: cleanupMediaResources tests.
 * SideEffects: None.
 */

import { describe, expect, it, vi } from 'vitest';
import { cleanupMediaResources } from './mediaResourceCleanup';

function createVideoElement() {
    const video = document.createElement('video');
    video.pause = vi.fn();
    video.load = vi.fn();
    video.src = 'https://example.test/live.m3u8';
    return video;
}

describe('cleanupMediaResources', () => {
    it('aborts pending work, destroys stream engines, clears refs, and resets video media', () => {
        const abortControllerRef = { current: { abort: vi.fn() } };
        const hlsRef = { current: { destroy: vi.fn() } };
        const flvRef = { current: { destroy: vi.fn() } };
        const video = createVideoElement();

        cleanupMediaResources({
            abortControllerRef,
            hlsRef,
            flvRef,
            videoElement: video,
        });

        expect(abortControllerRef.current).toBeNull();
        expect(hlsRef.current).toBeNull();
        expect(flvRef.current).toBeNull();
        expect(video.pause).toHaveBeenCalledTimes(1);
        expect(video.load).toHaveBeenCalledTimes(1);
        expect(video.getAttribute('src')).toBeNull();
    });

    it('can preserve video source while still clearing network and stream resources', () => {
        const abortControllerRef = { current: { abort: vi.fn() } };
        const hlsRef = { current: { destroy: vi.fn() } };
        const video = createVideoElement();

        cleanupMediaResources({
            abortControllerRef,
            hlsRef,
            videoElement: video,
            resetVideo: false,
        });

        expect(abortControllerRef.current).toBeNull();
        expect(hlsRef.current).toBeNull();
        expect(video.pause).not.toHaveBeenCalled();
        expect(video.src).toContain('https://example.test/live.m3u8');
    });
});
