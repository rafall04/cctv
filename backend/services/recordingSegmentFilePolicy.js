// Purpose: Classify and build recording segment paths for MP4 finalization recovery.
// Caller: recordingService, recordingSegmentFinalizer, recording cleanup, and tests.
// Deps: node:path, recordingTimePolicy.
// MainFuncs: getPendingRecordingDir, getPendingRecordingPattern, isFinalSegmentFilename, parseSegmentFilename.
// SideEffects: None.

import { join } from 'path';
import { parseRecordingFilenameTimestampMs } from './recordingTimePolicy.js';

const SEGMENT_STAMP = '(\\d{4})(\\d{2})(\\d{2})_(\\d{2})(\\d{2})(\\d{2})';
const FINAL_RE = new RegExp(`^${SEGMENT_STAMP}\\.mp4$`);
const PARTIAL_RE = new RegExp(`^${SEGMENT_STAMP}\\.mp4\\.partial$`);
const TEMP_RE = new RegExp(`^${SEGMENT_STAMP}(\\.tmp\\.mp4|\\.mp4\\.tmp|\\.mp4\\.remux\\.mp4|\\.mp4\\.temp\\.mp4|\\.temp\\.mp4)$`);

export function getCameraRecordingDir(basePath, cameraId) {
    return join(basePath, `camera${cameraId}`);
}

export function getPendingRecordingDir(basePath, cameraId) {
    return join(getCameraRecordingDir(basePath, cameraId), 'pending');
}

export function getPendingRecordingPattern(basePath, cameraId) {
    return join(getPendingRecordingDir(basePath, cameraId), '%Y%m%d_%H%M%S.mp4.partial');
}

export function getFinalRecordingPath(basePath, cameraId, finalFilename) {
    return join(getCameraRecordingDir(basePath, cameraId), finalFilename);
}

export function getTempRecordingPath(basePath, cameraId, finalFilename) {
    const finalName = String(finalFilename || '');
    if (!finalName.endsWith('.mp4')) {
        return `${getFinalRecordingPath(basePath, cameraId, finalName)}.tmp`;
    }
    return getFinalRecordingPath(basePath, cameraId, finalName.replace(/\.mp4$/, '.tmp.mp4'));
}

export function isFinalSegmentFilename(filename) {
    return FINAL_RE.test(filename);
}

export function isPartialSegmentFilename(filename) {
    return PARTIAL_RE.test(filename);
}

export function isTempSegmentFilename(filename) {
    return TEMP_RE.test(filename);
}

export function toFinalSegmentFilename(filename) {
    const parsed = parseSegmentFilename(filename);
    return parsed?.finalFilename ?? null;
}

export function parseSegmentFilename(filename) {
    const text = String(filename || '');
    if (text.includes('/') || text.includes('\\')) {
        return null;
    }

    const match = text.match(FINAL_RE) || text.match(PARTIAL_RE) || text.match(TEMP_RE);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second] = match;
    const finalFilename = `${year}${month}${day}_${hour}${minute}${second}.mp4`;
    const timestampMs = parseRecordingFilenameTimestampMs(finalFilename);
    if (!Number.isFinite(timestampMs)) {
        return null;
    }
    const timestamp = new Date(timestampMs);

    return {
        year,
        month,
        day,
        hour,
        minute,
        second,
        timestamp,
        timestampIso: timestamp.toISOString(),
        finalFilename,
    };
}
