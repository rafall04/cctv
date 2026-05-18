/**
 * Purpose: Validate ffprobe wrapper duration parsing + integer rounding.
 * Caller: Vitest backend suite.
 * Deps: createRecordingMediaProbe with injected execPromise.
 * MainFuncs: probeDuration, parseDurationStdout.
 * SideEffects: None; exec is mocked.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordingMediaProbe, parseDurationStdout } from '../services/recordingMediaProbe.js';

describe('parseDurationStdout', () => {
    it('rounds fractional seconds to integer', () => {
        expect(parseDurationStdout('600.123')).toBe(600);
        expect(parseDurationStdout('599.6')).toBe(600);
    });
    it('returns null for invalid or sub-second output', () => {
        expect(parseDurationStdout('')).toBeNull();
        expect(parseDurationStdout('not a number')).toBeNull();
        expect(parseDurationStdout('0.4')).toBeNull();
        expect(parseDurationStdout(null)).toBeNull();
    });
});

describe('createRecordingMediaProbe.probeDuration', () => {
    it('shells out to ffprobe with the configured timeout and returns parsed integer', async () => {
        const execPromise = vi.fn().mockResolvedValue({ stdout: '600.5\n' });
        const probe = createRecordingMediaProbe({ execPromise, timeoutMs: 1234 });

        const duration = await probe.probeDuration('/path/to/file.mp4');

        expect(duration).toBe(601);
        expect(execPromise).toHaveBeenCalledWith(
            expect.stringContaining('ffprobe'),
            expect.objectContaining({ timeout: 1234, encoding: 'utf8' })
        );
        expect(execPromise.mock.calls[0][0]).toContain('"/path/to/file.mp4"');
    });

    it('propagates errors from ffprobe', async () => {
        const execPromise = vi.fn().mockRejectedValue(new Error('ffprobe missing'));
        const probe = createRecordingMediaProbe({ execPromise });

        await expect(probe.probeDuration('/x')).rejects.toThrow(/ffprobe missing/);
    });
});
