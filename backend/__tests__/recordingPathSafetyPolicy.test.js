/**
 * Purpose: Validate recording file path and byte-range safety decisions.
 * Caller: Vitest backend test suite.
 * Deps: recordingPathSafetyPolicy.
 * MainFuncs: isPathInside, isSafeRecordingFilePath, normalizeRecordingRange.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'path';
import {
    isPathInside,
    isSafeRecordingFilePath,
    normalizeRecordingRange,
} from '../services/recordingPathSafetyPolicy.js';

describe('recordingPathSafetyPolicy', () => {
    const base = join(process.cwd(), '..', 'recordings');

    it('accepts only files inside the expected camera directory', () => {
        expect(isPathInside(join(base, 'camera7'), join(base, 'camera7', '20260517_010000.mp4'))).toBe(true);
        expect(isPathInside(join(base, 'camera7'), join(base, 'camera8', '20260517_010000.mp4'))).toBe(false);
        expect(isPathInside(join(base, 'camera7'), join(base, 'camera7'))).toBe(false);
    });

    it('rejects unsafe recording paths and mismatched filenames', () => {
        expect(isSafeRecordingFilePath({
            recordingsBasePath: base,
            cameraId: 7,
            filePath: join(base, 'camera7', '20260517_010000.mp4'),
            filename: '20260517_010000.mp4',
        })).toBe(true);
        expect(isSafeRecordingFilePath({
            recordingsBasePath: base,
            cameraId: 7,
            filePath: join(base, 'camera7', '..', 'camera8', '20260517_010000.mp4'),
            filename: '20260517_010000.mp4',
        })).toBe(false);
        expect(isSafeRecordingFilePath({
            recordingsBasePath: base,
            cameraId: 7,
            filePath: join(base, 'camera7', '20260517_010000.mp4'),
            filename: '20260517_011000.mp4',
        })).toBe(false);
    });

    it('normalizes valid byte ranges and rejects invalid ones', () => {
        expect(normalizeRecordingRange({ rangeHeader: 'bytes=10-19', fileSize: 100 })).toEqual({
            valid: true,
            partial: true,
            start: 10,
            end: 19,
            chunkSize: 10,
            contentRange: 'bytes 10-19/100',
        });
        expect(normalizeRecordingRange({ rangeHeader: 'bytes=90-', fileSize: 100 })).toMatchObject({
            valid: true,
            start: 90,
            end: 99,
            chunkSize: 10,
        });
        expect(normalizeRecordingRange({ rangeHeader: 'bytes=100-101', fileSize: 100 })).toEqual({
            valid: false,
            statusCode: 416,
            reason: 'range_not_satisfiable',
        });
        expect(normalizeRecordingRange({ rangeHeader: 'bytes=20-10', fileSize: 100 })).toEqual({
            valid: false,
            statusCode: 416,
            reason: 'range_not_satisfiable',
        });
    });
});
