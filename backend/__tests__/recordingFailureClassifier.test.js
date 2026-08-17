import { describe, expect, it } from 'vitest';
import { classifyRecordingExit } from '../services/recordingFailureClassifier.js';

describe('recordingFailureClassifier', () => {
    it('classifies manual stop with ffmpeg code 255 as intentional_stop', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'Immediate exit requested\nExiting normally, received signal 2.',
            exitCode: 255,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: 'manual_stop',
        })).toBe('intentional_stop');
    });

    it('classifies server shutdown signal output as intentional_shutdown', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'Error writing trailer: Immediate exit requested\nreceived signal 2',
            exitCode: 255,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: 'server_shutdown',
        })).toBe('intentional_shutdown');
    });

    it('classifies restart stop as restart_requested', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'Exiting normally, received signal 15.',
            exitCode: 255,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: 'stream_frozen_restart',
        })).toBe('restart_requested');
    });

    it('preserves upstream and source classifications for unknown exits', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'Connection timed out',
            exitCode: 1,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: null,
        })).toBe('upstream_unreachable');

        expect(classifyRecordingExit({
            ffmpegOutput: 'Invalid data found when processing input',
            exitCode: 1,
            exitSignal: null,
            streamSource: 'external',
            stopReason: null,
        })).toBe('unsupported_playlist');
    });

    /*
     * FFmpeg reports an unmuxable track TWICE, and the tail is what a naive matcher sees:
     * "...codec not currently supported in container" is followed by "Could not write
     * header for output file #0 (incorrect codec parameters ?): Invalid argument". Matched
     * on the tail this reads as `invalid_source` and sends the operator to check an RTSP
     * URL that is perfectly fine. Both lines here verbatim from the production binary.
     */
    it('names an unmuxable track codec instead of blaming the source', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: [
                '[mp4 @ 0x55b83ecf7000] Could not find tag for codec pcm_alaw in stream #1, codec not currently supported in container',
                'Could not write header for output file #0 (incorrect codec parameters ?): Invalid argument',
            ].join('\n'),
            exitCode: 1,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: null,
        })).toBe('unsupported_track_codec');
    });

    /*
     * REGRESSION (production, 2026-08-17): camera 1169 declares pcm_alaw in its SDP and never
     * sends an audio packet. FFmpeg buffers video waiting to interleave, overruns the muxing
     * queue and exits 1 in 8s with nothing written. Naming it apart from `ffmpeg_failed` is
     * what lets the recorder repair itself — see recordingAudioFallback.js.
     */
    it('names a stalled audio track so the recorder can drop it and retry', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'Too many packets buffered for output stream 0:0.',
            exitCode: 1,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: null,
        })).toBe('audio_stream_stalled');
    });

    it('still blames the source for a plain Invalid argument exit', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'rtsp://cam/stream: Invalid argument',
            exitCode: 1,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: null,
        })).toBe('invalid_source');
    });

    it('falls back to ffmpeg_failed for unknown non-zero exits', () => {
        expect(classifyRecordingExit({
            ffmpegOutput: 'muxer failed unexpectedly',
            exitCode: 1,
            exitSignal: null,
            streamSource: 'internal',
            stopReason: null,
        })).toBe('ffmpeg_failed');
    });
});
