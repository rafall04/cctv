/**
 * Purpose: Verify recording segment filename/path classification for finalization recovery.
 * Caller: Vitest backend test suite.
 * Deps: recordingSegmentFilePolicy.
 * MainFuncs: isFinalSegmentFilename, isPartialSegmentFilename, isTempSegmentFilename, parseSegmentFilename, getPendingRecordingDir, getFinalRecordingPath.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import {
    getFinalRecordingPath,
    getPendingRecordingDir,
    getPendingRecordingPattern,
    getTempRecordingPath,
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    isTempSegmentFilename,
    parseSegmentFilename,
    toFinalSegmentFilename,
} from '../services/recordingSegmentFilePolicy.js';

describe('recordingSegmentFilePolicy', () => {
    it('classifies final, partial, and temp segment filenames', () => {
        expect(isFinalSegmentFilename('20260511_211000.mp4')).toBe(true);
        expect(isFinalSegmentFilename('20260511_211000.mp4.partial')).toBe(false);
        expect(isPartialSegmentFilename('20260511_211000.mp4.partial')).toBe(true);
        expect(isTempSegmentFilename('20260511_211000.mp4.tmp')).toBe(true);
        expect(isTempSegmentFilename('20260511_211000.mp4.remux.mp4')).toBe(true);
    });

    it('parses timestamps from final and partial names into the same final filename', () => {
        expect(parseSegmentFilename('20260511_211000.mp4')).toMatchObject({
            finalFilename: '20260511_211000.mp4',
            timestampIso: '2026-05-11T14:10:00.000Z',
        });
        expect(parseSegmentFilename('20260511_211000.mp4.partial')).toMatchObject({
            finalFilename: '20260511_211000.mp4',
            timestampIso: '2026-05-11T14:10:00.000Z',
        });
        expect(toFinalSegmentFilename('20260511_211000.mp4.partial')).toBe('20260511_211000.mp4');
    });

    it('builds stable pending and final paths under the camera directory', () => {
        const basePath = 'C:\\recordings';
        expect(getPendingRecordingDir(basePath, 3)).toBe('C:\\recordings\\camera3\\pending');
        expect(getPendingRecordingPattern(basePath, 3)).toBe('C:\\recordings\\camera3\\pending\\%Y%m%d_%H%M%S.mp4.partial');
        expect(getFinalRecordingPath(basePath, 3, '20260511_211000.mp4')).toBe('C:\\recordings\\camera3\\20260511_211000.mp4');
        expect(getTempRecordingPath(basePath, 3, '20260511_211000.mp4')).toBe('C:\\recordings\\camera3\\20260511_211000.mp4.tmp');
    });

    it('rejects unsupported names', () => {
        expect(parseSegmentFilename('bad.mp4')).toBeNull();
        expect(parseSegmentFilename('../20260511_211000.mp4')).toBeNull();
        expect(parseSegmentFilename('20260511_211000.ts')).toBeNull();
    });
});
