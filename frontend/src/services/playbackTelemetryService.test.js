/**
 * Purpose: Pin the client telemetry contract — dedupe per signature, session cap, transports.
 * Caller: frontend test gate.
 * Deps: playbackTelemetryService, mocked fetch/sendBeacon/getApiUrl.
 * MainFuncs: reportPlaybackFailure.
 * SideEffects: None — transports are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/config.js', () => ({ getApiUrl: () => 'https://api.test' }));

import { reportPlaybackFailure, resetPlaybackTelemetryForTests } from './playbackTelemetryService.js';

describe('reportPlaybackFailure', () => {
    beforeEach(() => {
        resetPlaybackTelemetryForTests();
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
    });

    it('POSTs the event as JSON with keepalive and no credentials', () => {
        const ok = reportPlaybackFailure({ stage: 'source_load', errorCode: 'codec', cameraId: 7, segment: 'a.mp4' });
        expect(ok).toBe(true);
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toBe('https://api.test/api/public/playback-telemetry');
        expect(opts.method).toBe('POST');
        expect(opts.keepalive).toBe(true);
        expect(opts.credentials).toBe('omit');
        expect(JSON.parse(opts.body)).toMatchObject({ stage: 'source_load', cameraId: 7 });
    });

    it('dedupes identical failures — a retry loop must not flood the endpoint', () => {
        const evt = { stage: 'seek_stall', cameraId: 3, segment: 'b.mp4' };
        expect(reportPlaybackFailure(evt)).toBe(true);
        expect(reportPlaybackFailure(evt)).toBe(false);
        expect(reportPlaybackFailure(evt)).toBe(false);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('hard-caps the number of reports per page load', () => {
        for (let i = 0; i < 25; i += 1) {
            reportPlaybackFailure({ stage: 'unknown', cameraId: i });
        }
        expect(fetch).toHaveBeenCalledTimes(20);
    });

    it('refuses events without a stage', () => {
        expect(reportPlaybackFailure({ cameraId: 1 })).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('falls back to sendBeacon when fetch is unavailable', () => {
        vi.stubGlobal('fetch', undefined);
        const sendBeacon = vi.fn(() => true);
        vi.stubGlobal('navigator', { sendBeacon });
        expect(reportPlaybackFailure({ stage: 'buffer_stall' })).toBe(true);
        expect(sendBeacon).toHaveBeenCalledWith('https://api.test/api/public/playback-telemetry', expect.any(Blob));
    });
});
