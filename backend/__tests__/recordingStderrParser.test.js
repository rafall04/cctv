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

    /*
     * FFmpeg's verdict on a track the container cannot hold carries none of the words the
     * generic rule looks for ('error' / 'Error' / 'failed'), so it used to be dropped as
     * 'other' — losing the only line that says WHY the recorder died. Text is the real
     * message from the production binary (ffmpeg 4.2.7) fed a G.711 camera into MP4.
     */
    it('surfaces an unmuxable-codec line that carries none of the usual error words', () => {
        const line = '[mp4 @ 0x55b83ecf7000] Could not find tag for codec pcm_alaw in stream #1, codec not currently supported in container';
        expect(parseRecordingStderrLine(line)).toMatchObject({ kind: 'error', logLine: line });
    });

    it('treats unrecognized lines as other', () => {
        expect(parseRecordingStderrLine('frame=  100 fps= 25').kind).toBe('other');
        expect(parseRecordingStderrLine('').kind).toBe('other');
    });
});
