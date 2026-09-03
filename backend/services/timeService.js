/**
 * Purpose: Centralize backend timestamp formatting/parsing rules for UTC SQL and configured local SQL values.
 * Caller: Viewer/playback session services, token services, and future backend flows that write or compare timestamps.
 * Deps: timezoneService and Intl date formatting.
 * MainFuncs: nowLocalSql, resolveLocalSqlTimestamp, diffLocalSqlSeconds, getLocalDate, getLocalDateWithOffset, getLocalSqlWithOffsetDays, toUtcSql.
 * SideEffects: Reads configured timezone through timezoneService.
 */

import { getTimezone } from './timezoneService.js';

const LOCAL_SQL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;

function pad(value) {
    return String(value).padStart(2, '0');
}

function getZonedParts(date = new Date(), timezone = getTimezone()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    return {
        ...parts,
        hour: parts.hour === '24' ? '00' : parts.hour,
    };
}

function parseLocalSqlParts(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const match = value.trim().match(LOCAL_SQL_PATTERN);
    if (!match) {
        return null;
    }

    return {
        year: Number.parseInt(match[1], 10),
        month: Number.parseInt(match[2], 10),
        day: Number.parseInt(match[3], 10),
        hour: Number.parseInt(match[4], 10),
        minute: Number.parseInt(match[5], 10),
        second: Number.parseInt(match[6], 10),
    };
}

function formatLocalSqlParts(parts) {
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function utcDateToLocalSqlParts(date) {
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
    };
}

function localSqlToComparableMs(value) {
    const parts = parseLocalSqlParts(value);
    if (parts) {
        return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function nowLocalSql(date = new Date(), timezone = getTimezone()) {
    const parts = getZonedParts(date, timezone);
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function resolveLocalSqlTimestamp(value = new Date(), timezone = getTimezone()) {
    if (typeof value === 'string' && parseLocalSqlParts(value)) {
        return formatLocalSqlParts(parseLocalSqlParts(value));
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return nowLocalSql(new Date(value), timezone);
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return nowLocalSql(value, timezone);
    }

    if (typeof value === 'string') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return nowLocalSql(parsed, timezone);
        }
    }

    return nowLocalSql(new Date(), timezone);
}

export function diffLocalSqlSeconds(startValue, endValue) {
    const startMs = localSqlToComparableMs(startValue);
    const endMs = localSqlToComparableMs(endValue);

    if (startMs === null || endMs === null) {
        return 0;
    }

    return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

export function getLocalDate(date = new Date(), timezone = getTimezone()) {
    const parts = getZonedParts(date, timezone);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getLocalDateWithOffset(days, date = new Date(), timezone = getTimezone()) {
    const [year, month, day] = getLocalDate(date, timezone).split('-').map((part) => Number.parseInt(part, 10));
    const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function getLocalSqlWithOffsetDays(days, date = new Date(), timezone = getTimezone()) {
    const currentLocalSql = resolveLocalSqlTimestamp(date, timezone);
    const parts = parseLocalSqlParts(currentLocalSql);
    if (!parts) {
        return currentLocalSql;
    }

    const shifted = new Date(Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day + days,
        parts.hour,
        parts.minute,
        parts.second
    ));
    return formatLocalSqlParts(utcDateToLocalSqlParts(shifted));
}

export function toUtcSql(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * UTC twin of resolveLocalSqlTimestamp: a bare SQL datetime string is assumed to ALREADY be UTC and
 * passed through (normalized to 'YYYY-MM-DD HH:MM:SS'); a Date/epoch-ms/parseable string is converted
 * to UTC SQL. Used on the session end path where the input may be a stored UTC string (stale-cleanup
 * hands back last_heartbeat) or a fresh Date.
 */
export function resolveUtcSqlTimestamp(value = new Date()) {
    if (typeof value === 'string' && LOCAL_SQL_PATTERN.test(value.trim())) {
        return value.trim().replace('T', ' ').slice(0, 19);
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return toUtcSql(new Date(value));
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return toUtcSql(value);
    }

    if (typeof value === 'string') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return toUtcSql(parsed);
        }
    }

    return toUtcSql(new Date());
}

export function parseUtcSql(value) {
    if (!value) {
        return null;
    }

    if (typeof value === 'string' && LOCAL_SQL_PATTERN.test(value.trim())) {
        const parsed = new Date(`${value.trim().replace(' ', 'T')}Z`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Minutes east of UTC for the configured timezone at the current instant (Asia/Jakarta → 420).
 * Reads the offset off Intl's shortOffset name so it handles whole- and half-hour zones alike.
 * NOTE: sampled at "now", so for a DST zone it reflects the CURRENT offset only — the shipped
 * Indonesian zones (WIB/WITA/WIT) are fixed-offset, so this is exact for them.
 */
export function getTimezoneOffsetMinutes(timezone = getTimezone()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
            .formatToParts(new Date());
        const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+0';
        const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
        if (!match) {
            return 0;
        }
        const sign = match[1] === '-' ? -1 : 1;
        return sign * (Number.parseInt(match[2], 10) * 60 + Number.parseInt(match[3] || '0', 10));
    } catch {
        return 0;
    }
}

/**
 * A SQLite datetime() modifier that converts a UTC-stored timestamp into the configured display
 * timezone, e.g. '+420 minutes' for Asia/Jakarta. Use it so day/hour BUCKETING reads in the
 * operator's wall-clock while storage stays UTC:
 *     date(started_at, ?)            -- ? = getSqliteTzOffsetModifier()
 *     strftime('%H', started_at, ?)
 * A single "minutes" modifier keeps it to one bound parameter and supports half-hour zones.
 * EXACT ONLY FOR FIXED-OFFSET ZONES (all shipped Indonesian zones qualify); a DST zone would need
 * JS-side bucketing instead — see getTimezoneOffsetMinutes.
 */
export function getSqliteTzOffsetModifier(timezone = getTimezone()) {
    const minutes = getTimezoneOffsetMinutes(timezone);
    return `${minutes >= 0 ? '+' : '-'}${Math.abs(minutes)} minutes`;
}
