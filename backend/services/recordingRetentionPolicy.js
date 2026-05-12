// Purpose: Provide pure retention and recording filename decisions for cleanup flows.
// Caller: recordingService, recordingCleanupService, recordingRetentionPolicy tests.
// Deps: Node path basename utility.
// MainFuncs: computeRetentionWindow, parseSegmentFilenameTimeMs, isSafeRecordingFilename, canDeleteRecordingFile, describeRecordingRetentionDecision.
// SideEffects: None.

import { basename } from 'path';
import { isFinalSegmentFilename, isTempSegmentFilename } from './recordingSegmentFilePolicy.js';

export const RECORDING_RETENTION_GRACE_MS = 10 * 60 * 1000;
export const DEFAULT_RECORDING_RETENTION_HOURS = 5;

export function normalizeRetentionHours(retentionHours) {
    const parsed = Number(retentionHours);
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_RECORDING_RETENTION_HOURS;
}

export function computeRetentionWindow({ retentionHours, nowMs = Date.now() }) {
    const retentionHoursValue = normalizeRetentionHours(retentionHours);
    const retentionMs = retentionHoursValue * 60 * 60 * 1000;
    const graceMs = Math.max(RECORDING_RETENTION_GRACE_MS, retentionMs * 0.1);
    const retentionWithGraceMs = retentionMs + graceMs;
    const cutoffMs = nowMs - retentionWithGraceMs;

    return {
        retentionHours: retentionHoursValue,
        retentionMs,
        graceMs,
        retentionWithGraceMs,
        cutoffMs,
        cutoffIso: new Date(cutoffMs).toISOString(),
    };
}

export function parseSegmentFilenameTimeMs(filename) {
    const safeName = basename(String(filename || ''));
    const match = safeName.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/);

    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second] = match.map(Number);
    return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function isSafeRecordingFilename(filename) {
    const value = String(filename || '');
    if (value !== basename(value)) {
        return false;
    }

    return isFinalSegmentFilename(value) || isTempSegmentFilename(value);
}

export function getSegmentAgeMs({ filename, startTime, fileMtimeMs, nowMs = Date.now() }) {
    const filenameTimeMs = parseSegmentFilenameTimeMs(filename);
    const startTimeMs = startTime ? Date.parse(startTime) : NaN;
    const candidates = [filenameTimeMs, startTimeMs, fileMtimeMs]
        .filter((value) => Number.isFinite(value));

    if (candidates.length === 0) {
        return 0;
    }

    const newestTrustworthyTimeMs = Math.max(...candidates);
    return Math.max(0, nowMs - newestTrustworthyTimeMs);
}

export function isExpiredByRetention(startTime, retentionWindow) {
    const startMs = Date.parse(startTime);
    return Number.isFinite(startMs) && startMs < retentionWindow.cutoffMs;
}

export function canDeleteRecordingFile({
    filename,
    startTime = null,
    fileMtimeMs = null,
    retentionWindow,
    nowMs = Date.now(),
}) {
    if (!isSafeRecordingFilename(filename)) {
        return { allowed: false, reason: 'unsafe_filename', ageMs: 0 };
    }

    const ageMs = getSegmentAgeMs({ filename, startTime, fileMtimeMs, nowMs });
    if (ageMs <= retentionWindow.retentionWithGraceMs) {
        return { allowed: false, reason: 'retention_not_expired', ageMs };
    }

    return { allowed: true, reason: 'retention_expired', ageMs };
}

export function describeRecordingRetentionDecision({ filename, decision }) {
    const reason = decision?.reason || 'unknown';
    const ageSeconds = Math.round((decision?.ageMs || 0) / 1000);
    return `${reason} filename=${filename} age_seconds=${ageSeconds}`;
}
