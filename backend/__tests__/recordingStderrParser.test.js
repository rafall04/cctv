/**
 * Purpose: Validate FFmpeg stderr classification used by recording facade.
 * Caller: Vitest backend suite.
 * Deps: recordingStderrParser (pure).
 * MainFuncs: parseRecordingStderrLine.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { parseRecordingStderrLine } from '../services/recordingStderrParser.js';

describe('parseRecordingStderrLine', () => {
    it('detects final segment completion on Closing line', () => {
        const result = parseRecordingStderrLine("[segment @ 0x1] Closing '/recordings/camera5/20260518_120000.mp4' for writing");
        expect(result.kind).toBe('segment_completed');
        expect(result.filename).toBe('20260518_120000.mp4');
    });

    it('detects partial segment completion on Closing line', () => {
        const result = parseRecordingStderrLine("Closing '20260518_120000.mp4.partial'");
        expect(result).toMatchObject({ kind: 'segment_completed', filename: '20260518_120000.mp4.partial' });
    });

    it('classifies non-Closing segment lines as segment_debug', () => {
        const result = parseRecordingStderrLine("[segment @ 0x1] Opening '/recordings/camera5/20260518_120000.mp4' for writing");
        expect(result.kind).toBe('segment_debug');
    });

    it('classifies error/failed lines as error (skipping benign Closing errors)', () => {
        expect(parseRecordingStderrLine('Error opening filters').kind).toBe('error');
        expect(parseRecordingStderrLine('failed to read frame').kind).toBe('error');
        expect(parseRecordingStderrLine('Closing input stream after error').kind).not.toBe('error');
    });

    it('treats unrecognized lines as other', () => {
        expect(parseRecordingStderrLine('frame=  100 fps= 25').kind).toBe('other');
        expect(parseRecordingStderrLine('').kind).toBe('other');
    });
});
