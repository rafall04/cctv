/**
 * Purpose: Verify recording segment filename/path classification for finalization recovery.
 * Caller: Vitest backend test suite.
 * Deps: recordingSegmentFilePolicy.
 * MainFuncs: isFinalSegmentFilename, isPartialSegmentFilename, isTempSegmentFilename, parseSegmentFilename, getPendingRecordingDir, getFinalRecordingPath, getTempRecordingPath.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
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
        expect(isTempSegmentFilename('20260511_211000.tmp.mp4')).toBe(true);
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

    it('parses segment timestamps with the configured app timezone', () => {
        expect(parseSegmentFilename('20260518_170000.mp4', 'Asia/Jakarta')).toMatchObject({
            finalFilename: '20260518_170000.mp4',
            timestampIso: '2026-05-18T10:00:00.000Z',
        });
    });

    it('builds stable pending and final paths under the camera directory', () => {
        // path.join expectations, not Windows literals: the contract is native-separator
        // joins under <base>/cameraN, and the hardcoded 'C:\\...' shapes failed on Linux CI.
        const basePath = path.join('recordings-root');
        const pendingDir = path.join(basePath, 'camera3', 'pending');
        expect(getPendingRecordingDir(basePath, 3)).toBe(pendingDir);
        expect(getPendingRecordingPattern(basePath, 3)).toBe(path.join(pendingDir, '%Y%m%d_%H%M%S.mp4.partial'));
        expect(getFinalRecordingPath(basePath, 3, '20260511_211000.mp4')).toBe(path.join(basePath, 'camera3', '20260511_211000.mp4'));
        expect(getTempRecordingPath(basePath, 3, '20260511_211000.mp4')).toBe(path.join(basePath, 'camera3', '20260511_211000.tmp.mp4'));
    });

    it('builds MP4-compatible temp remux filenames', () => {
        const basePath = path.join('recordings-root');
        expect(getTempRecordingPath(basePath, 7, '20260512_000005.mp4'))
            .toBe(path.join(basePath, 'camera7', '20260512_000005.tmp.mp4'));
    });

    it('recognizes current and legacy temp remux filenames', () => {
        expect(isTempSegmentFilename('20260512_000005.tmp.mp4')).toBe(true);
        expect(isTempSegmentFilename('20260512_000005.mp4.tmp')).toBe(true);
        expect(isTempSegmentFilename('20260512_000005.mp4.remux.mp4')).toBe(true);
    });

    it('classifies all supported recording temp segment names', () => {
        expect(isTempSegmentFilename('20260512_000005.tmp.mp4')).toBe(true);
        expect(isTempSegmentFilename('20260512_000005.mp4.tmp')).toBe(true);
        expect(isTempSegmentFilename('20260512_000005.mp4.remux.mp4')).toBe(true);
        expect(isTempSegmentFilename('20260512_000005.mp4.temp.mp4')).toBe(true);
        expect(isTempSegmentFilename('20260512_000005.temp.mp4')).toBe(true);
        expect(isTempSegmentFilename('x.temp.mp4')).toBe(false);
        expect(isTempSegmentFilename('../20260512_000005.tmp.mp4')).toBe(false);
    });

    it('rejects unsupported names', () => {
        expect(parseSegmentFilename('bad.mp4')).toBeNull();
        expect(parseSegmentFilename('../20260511_211000.mp4')).toBeNull();
        expect(parseSegmentFilename('20260511_211000.ts')).toBeNull();
    });
});
