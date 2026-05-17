// Purpose: Provide pure retention and recording filename decisions for cleanup flows.
// Caller: recordingService, recordingCleanupService, recordingRetentionPolicy tests.
// Deps: Node path basename utility, recording time policy.
// MainFuncs: computeRetentionWindow, parseSegmentFilenameTimeMs, isSafeRecordingFilename, canDeleteRecordingFile, describeRecordingRetentionDecision.
// SideEffects: None.

import { basename } from 'path';
import {
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    isTempSegmentFilename,
} from './recordingSegmentFilePolicy.js';
import {
    getRecordingAgeMs,
    parseRecordingDateMs,
    parseRecordingFilenameTimestampMs,
} from './recordingTimePolicy.js';

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
    return parseRecordingFilenameTimestampMs(filename);
}

export function isSafeRecordingFilename(filename) {
    const value = String(filename || '');
    if (value !== basename(value)) {
        return false;
    }

    return isFinalSegmentFilename(value)
        || isPartialSegmentFilename(value)
        || isTempSegmentFilename(value);
}

export function getSegmentAgeMs({ filename, startTime, fileMtimeMs, nowMs = Date.now() }) {
    return getRecordingAgeMs({ filename, startTime, fileMtimeMs, nowMs });
}

export function isExpiredByRetention(startTime, retentionWindow) {
    const startMs = parseRecordingDateMs(startTime);
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
