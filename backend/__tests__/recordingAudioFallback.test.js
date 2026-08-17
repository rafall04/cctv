/**
 * Purpose: Locks the per-camera audio fallback — which failures disable audio, and which must not.
 * Caller: Backend Vitest suite.
 * Deps: recordingAudioFallback + recordingStarter (pure), fs mocked for prepareRecordingStart.
 * MainFuncs: shouldSkipRecordingAudio, markRecordingAudioUnusable, isAudioFaultReason.
 * SideEffects: None; module state is cleared between tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spread the real module: recordingStarter pulls in the DB layer transitively, and that
// needs existsSync at import time. A bare stub takes the whole import graph down with it.
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return { ...actual, mkdirSync: vi.fn() };
});

import {
    clearRecordingAudioFallback,
    isAudioFaultReason,
    listRecordingAudioFallbacks,
    markRecordingAudioUnusable,
    shouldSkipRecordingAudio,
} from '../services/recordingAudioFallback.js';

beforeEach(() => {
    clearRecordingAudioFallback();
});

describe('recordingAudioFallback', () => {
    it('records nothing until a camera has actually failed', () => {
        expect(shouldSkipRecordingAudio(1169)).toBe(false);
        expect(listRecordingAudioFallbacks()).toEqual([]);
    });

    it('reports the FIRST mark only, so the operator gets one line and not a stream', () => {
        expect(markRecordingAudioUnusable(1169)).toBe(true);
        expect(markRecordingAudioUnusable(1169)).toBe(false);
        expect(shouldSkipRecordingAudio(1169)).toBe(true);
    });

    it('is per camera and tolerates string ids from the DB layer', () => {
        markRecordingAudioUnusable('1169');

        expect(shouldSkipRecordingAudio(1169)).toBe(true);
        expect(shouldSkipRecordingAudio('1169')).toBe(true);
        expect(shouldSkipRecordingAudio(9)).toBe(false);
    });

    it('ignores an id that is not a number instead of poisoning the set', () => {
        expect(markRecordingAudioUnusable(undefined)).toBe(false);
        expect(markRecordingAudioUnusable('bukan-angka')).toBe(false);
        expect(listRecordingAudioFallbacks()).toEqual([]);
    });

    /*
     * The dangerous direction. Disabling audio must be reserved for failures that are ACTUALLY
     * about the audio track — an unreachable camera or a deliberate stop is not one, and quietly
     * dropping a working microphone because the network blipped would be the same class of bug
     * this module exists to fix, only harder to notice.
     */
    it('only treats genuine audio faults as a reason to drop the microphone', () => {
        expect(isAudioFaultReason('audio_stream_stalled')).toBe(true);
        expect(isAudioFaultReason('unsupported_track_codec')).toBe(true);

        for (const reason of [
            'upstream_unreachable',
            'ffmpeg_failed',
            'invalid_source',
            'unsupported_playlist',
            'intentional_stop',
            'intentional_shutdown',
            'restart_requested',
            undefined,
            null,
        ]) {
            expect(isAudioFaultReason(reason)).toBe(false);
        }
    });
});

/*
 * REGRESSION (production, 2026-08-17): camera 1169 declares `pcm_alaw` in its SDP and never
 * sends a single audio packet over its mandatory UDP transport. FFmpeg buffered video waiting
 * to interleave, overran the muxing queue, and exited 1 in 8 seconds having written nothing —
 * turning a recorder that had worked for months into a dead one. `-map 0:a?` cannot catch this:
 * the track IS declared. The repair has to happen after the failure.
 */
describe('recordingStarter honours the fallback', () => {
    const camera = {
        id: 1169,
        enabled: 1,
        enable_recording: 1,
        delivery_type: 'internal_hls',
        private_rtsp_url: 'rtsp://cam/onvif1',
        internal_rtsp_transport_override: 'udp',
    };

    it('maps audio for a camera that has not failed', async () => {
        const { prepareRecordingStart } = await import('../services/recordingStarter.js');
        const result = prepareRecordingStart({ camera, recordingsBasePath: '/recordings' });

        expect(result.success).toBe(true);
        expect(result.ffmpegArgs).toContain('0:a?');
        expect(result.ffmpegArgs).not.toContain('-an');
    });

    it('spawns the SAME camera video-only once its audio is marked unusable', async () => {
        const { prepareRecordingStart } = await import('../services/recordingStarter.js');
        markRecordingAudioUnusable(1169);

        const result = prepareRecordingStart({ camera, recordingsBasePath: '/recordings' });

        expect(result.success).toBe(true);
        expect(result.ffmpegArgs).not.toContain('0:a?');
        expect(result.ffmpegArgs).not.toContain('-c:a');
        expect(result.ffmpegArgs).toContain('-an');
        // The video half is untouched — this drops audio, it does not degrade the footage.
        expect(result.ffmpegArgs[result.ffmpegArgs.indexOf('-c:v') + 1]).toBe('copy');
    });

    it('leaves every OTHER camera recording audio', async () => {
        const { prepareRecordingStart } = await import('../services/recordingStarter.js');
        markRecordingAudioUnusable(1169);

        const other = prepareRecordingStart({
            camera: { ...camera, id: 9 },
            recordingsBasePath: '/recordings',
        });

        expect(other.ffmpegArgs).toContain('0:a?');
        expect(other.ffmpegArgs).not.toContain('-an');
    });

    it('lets an explicit withAudio=false override the global knob', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingStarter.js');

        const args = buildRecordingFfmpegArgs({
            cameraDir: '/recordings/camera1169',
            outputPattern: '/r/c/%Y.mp4',
            inputUrl: 'rtsp://cam/onvif1',
            streamSource: 'internal',
            rtspTransport: 'udp',
            withAudio: false,
        });

        expect(args).toContain('-an');
        expect(args).not.toContain('0:a?');
    });
});
