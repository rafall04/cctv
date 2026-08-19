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

/*
 * REGRESSION (2026-08-19 audit T4): the intentional/restart sets listed reasons nothing produces
 * ('camera_disabled', 'process_shutdown') while the reasons real callers pass fell through to
 * `ffmpeg_failed`. Every deliberate stop was then logged as a crash AND counted as a failure — and
 * a freeze-restart counted twice (monitor tick + the close it caused), so the circuit breaker
 * suspended a camera in half the intended number of failures.
 */
describe('penghentian yang DISENGAJA tidak boleh divonis crash', () => {
    const closedByUs = (stopReason) => classifyRecordingExit({
        ffmpegOutput: '', exitCode: 255, exitSignal: null, streamSource: 'internal', stopReason,
    });

    it('mengenali alasan stop yang benar-benar dikirim pemanggil', () => {
        expect(closedByUs('admin_stop')).toBe('intentional_stop');
        expect(closedByUs('camera_or_recording_disabled')).toBe('intentional_stop');
        expect(closedByUs('delivery_not_recordable')).toBe('intentional_stop');
        expect(closedByUs('camera_offline')).toBe('intentional_stop');
        expect(closedByUs('manual_stop')).toBe('intentional_stop');
    });

    it('mengenali restart, termasuk yang dari freeze detector dan ganti sumber', () => {
        expect(closedByUs('stream_frozen')).toBe('restart_requested');
        expect(closedByUs('camera_source_updated')).toBe('restart_requested');
    });

    /*
     * restartRecording menempelkan '_restart' pada alasan apa pun yang diterimanya, jadi
     * 'api_restart' menjadi 'api_restart_restart'. Mencocokkan akhirannya berarti alasan restart
     * baru apa pun ikut tertangkap tanpa ada yang perlu ingat menambahkannya ke daftar.
     */
    it('menangkap akhiran _restart yang dibuat restartRecording', () => {
        expect(closedByUs('api_restart_restart')).toBe('restart_requested');
        expect(closedByUs('camera_source_updated_restart')).toBe('restart_requested');
        expect(closedByUs('alasan_baru_yang_belum_ada_restart')).toBe('restart_requested');
    });

    it('crash sungguhan TETAP dilaporkan sebagai kegagalan', () => {
        expect(closedByUs(null)).toBe('ffmpeg_failed');
        expect(closedByUs('process_crashed')).toBe('ffmpeg_failed');
        expect(classifyRecordingExit({
            ffmpegOutput: 'Server returned 404 Not Found', exitCode: 1, stopReason: null,
        })).toBe('upstream_unreachable');
    });
});
