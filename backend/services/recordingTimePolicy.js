// Purpose: Provide one app-timezone-to-UTC timestamp policy for recording filename, DB, and retention age calculations.
// Caller: recordingSegmentFilePolicy, recordingRetentionPolicy, cleanup, recovery, and playback tests.
// Deps: node:path, timezoneService.
// MainFuncs: getRecordingTimestampTimezone, parseRecordingFilenameTimestampMs, parseRecordingDateMs, getRecordingAgeMs.
// SideEffects: Reads configured application timezone.

import { basename } from 'path';
import { getTimezone } from './timezoneService.js';

const RECORDING_STAMP_RE = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4(?:\.partial)?$/;
const DEFAULT_RECORDING_TIMEZONE = 'Asia/Jakarta';
const formatterCache = new Map();

export function normalizeRecordingTimezone(timezone) {
    const value = String(timezone || '').trim();
    if (!value) {
        return DEFAULT_RECORDING_TIMEZONE;
    }

    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
        return value;
    } catch {
        return DEFAULT_RECORDING_TIMEZONE;
    }
}

export function getRecordingTimestampTimezone() {
    return normalizeRecordingTimezone(getTimezone());
}

function getZonedFormatter(timezone) {
    const resolvedTimezone = normalizeRecordingTimezone(timezone);
    if (!formatterCache.has(resolvedTimezone)) {
        formatterCache.set(resolvedTimezone, new Intl.DateTimeFormat('en-US', {
            timeZone: resolvedTimezone,
            hour12: false,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }));
    }
    return formatterCache.get(resolvedTimezone);
}

function getZonedParts(date, timezone) {
    const parts = {};
    for (const part of getZonedFormatter(timezone).formatToParts(date)) {
        if (part.type !== 'literal') {
            parts[part.type] = Number(part.value);
        }
    }

    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour === 24 ? 0 : parts.hour,
        minute: parts.minute,
        second: parts.second,
    };
}

function getTimezoneOffsetMs(utcMs, timezone) {
    const parts = getZonedParts(new Date(utcMs), timezone);
    const localAsUtcMs = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
    );
    return localAsUtcMs - utcMs;
}

export function recordingLocalPartsToUtcMs({ year, month, day, hour, minute, second }, timezone = getRecordingTimestampTimezone()) {
    const resolvedTimezone = normalizeRecordingTimezone(timezone);
    const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const firstPassUtcMs = localAsUtcMs - getTimezoneOffsetMs(localAsUtcMs, resolvedTimezone);
    return localAsUtcMs - getTimezoneOffsetMs(firstPassUtcMs, resolvedTimezone);
}

export function parseRecordingFilenameTimestampMs(filename, timezone = getRecordingTimestampTimezone()) {
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
    return recordingLocalPartsToUtcMs({ year, month, day, hour, minute, second }, timezone);
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
