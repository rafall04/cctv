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
