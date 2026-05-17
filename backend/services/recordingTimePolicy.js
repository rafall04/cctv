// Purpose: Provide one UTC-first timestamp policy for recording filename, DB, and retention age calculations.
// Caller: recordingSegmentFilePolicy, recordingRetentionPolicy, cleanup, recovery, and playback tests.
// Deps: node:path.
// MainFuncs: parseRecordingFilenameTimestampMs, parseRecordingDateMs, getRecordingAgeMs.
// SideEffects: None.

import { basename } from 'path';

const RECORDING_STAMP_RE = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4(?:\.partial)?$/;

export function parseRecordingFilenameTimestampMs(filename) {
    const value = String(filename || '');
    const safeName = basename(value);
    if (safeName !== value) {
        return null;
    }

    const match = safeName.match(RECORDING_STAMP_RE);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second] = match.map(Number);
    return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function parseRecordingDateMs(value) {
    if (!value) {
        return null;
    }

    const text = String(value);
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
        ? `${text.replace(' ', 'T')}.000Z`
        : text;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

export function getRecordingAgeMs({ filename, startTime = null, fileMtimeMs = null, nowMs = Date.now() }) {
    const candidates = [
        parseRecordingFilenameTimestampMs(filename),
        parseRecordingDateMs(startTime),
        Number.isFinite(fileMtimeMs) ? fileMtimeMs : null,
    ].filter((value) => Number.isFinite(value));

    if (candidates.length === 0) {
        return 0;
    }

    return Math.max(0, nowMs - Math.max(...candidates));
}
