/**
 * Purpose: Verify FFmpeg major-version detection and the version-specific RTSP
 *          socket-timeout option, whose wrong spelling kills every internal recorder.
 * Caller: Vitest backend suite.
 * Deps: injected exec; no real ffmpeg required.
 * SideEffects: None.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFfmpegMajorVersion, resetFfmpegCapabilitiesCache } from '../utils/ffmpegCapabilities.js';
import { buildFfmpegRtspInputArgs } from '../utils/internalRtspTransportPolicy.js';

beforeEach(() => resetFfmpegCapabilitiesCache());

describe('getFfmpegMajorVersion', () => {
    it.each([
        ['ffmpeg version 4.2.7-0ubuntu0.1 Copyright (c) 2000-2022', 4],
        ['ffmpeg version n6.0 Copyright (c) 2000-2023', 6],
        ['ffmpeg version 7.1.1-static https://johnvansickle.com', 7],
    ])('parses %s', (banner, expected) => {
        expect(getFfmpegMajorVersion({ exec: () => banner })).toBe(expected);
    });

    it('returns null when ffmpeg is missing — must never throw into a recording start', () => {
        expect(getFfmpegMajorVersion({ exec: () => { throw new Error('ENOENT'); } })).toBeNull();
    });

    it('probes only once and caches', () => {
        const exec = vi.fn(() => 'ffmpeg version 4.2.7');
        getFfmpegMajorVersion({ exec });
        getFfmpegMajorVersion({ exec });
        expect(exec).toHaveBeenCalledTimes(1);
    });
});

describe('buildFfmpegRtspInputArgs — RTSP socket timeout option', () => {
    const opts = (v) => ({ socketTimeoutMicros: 20_000_000, ffmpegMajorVersion: v });

    it('uses -stimeout on FFmpeg 4.x', () => {
        const args = buildFfmpegRtspInputArgs('rtsp://cam', 'tcp', opts(4));
        expect(args).toContain('-stimeout');
        expect(args).not.toContain('-timeout');
    });

    it('uses -timeout on FFmpeg 5+, where -stimeout no longer exists', () => {
        // An unknown option makes ffmpeg exit instantly. Hard-coding -stimeout meant an
        // OS upgrade would take every internal RTSP recorder down at once.
        for (const major of [5, 6, 7]) {
            const args = buildFfmpegRtspInputArgs('rtsp://cam', 'tcp', opts(major));
            expect(args).toContain('-timeout');
            expect(args).not.toContain('-stimeout');
        }
    });

    it('falls back to 4.x behaviour when the version is unknown', () => {
        // Biased on purpose: guessing wrong is worse than keeping what is proven to work
        // on the version actually deployed.
        expect(buildFfmpegRtspInputArgs('rtsp://cam', 'tcp', opts(null))).toContain('-stimeout');
    });

    it('omits the timeout entirely when none is requested', () => {
        const args = buildFfmpegRtspInputArgs('rtsp://cam', 'tcp', { ffmpegMajorVersion: 6 });
        expect(args).not.toContain('-timeout');
        expect(args).not.toContain('-stimeout');
        expect(args).toEqual(['-rtsp_transport', 'tcp', '-i', 'rtsp://cam']);
    });
});
