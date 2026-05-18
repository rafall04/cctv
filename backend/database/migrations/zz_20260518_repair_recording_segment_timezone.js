// Purpose: Repair recording segment UTC timestamps that were derived from app-local FFmpeg filenames as UTC.
// Caller: Backend migration runner after recording_segments and system_settings exist.
// Deps: better-sqlite3 database file, fs stat, Intl timezone formatting.
// MainFuncs: migration script body, parseRecordingFilenameTimestampMs.
// SideEffects: Updates selected recording_segments start_time/end_time rows when repair evidence is strong.

import Database from 'better-sqlite3';
import { existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

const DEFAULT_TIMEZONE = 'Asia/Jakarta';
const FILENAME_RE = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/;
const formatterCache = new Map();
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

function tableExists(tableName) {
    return Boolean(db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
    `).get(tableName));
}

function normalizeTimezone(timezone) {
    const value = String(timezone || '').trim();
    if (!value) {
        return DEFAULT_TIMEZONE;
    }

    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
        return value;
    } catch {
        return DEFAULT_TIMEZONE;
    }
}

function getConfiguredTimezone() {
    if (!tableExists('system_settings')) {
        return DEFAULT_TIMEZONE;
    }

    const row = db.prepare(`
        SELECT setting_value
        FROM system_settings
        WHERE setting_key = 'timezone'
    `).get();
    return normalizeTimezone(row?.setting_value);
}

function getFormatter(timezone) {
    if (!formatterCache.has(timezone)) {
        formatterCache.set(timezone, new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
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
    return formatterCache.get(timezone);
}

function getZonedParts(date, timezone) {
    const parts = {};
    for (const part of getFormatter(timezone).formatToParts(date)) {
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

function localPartsToUtcMs({ year, month, day, hour, minute, second }, timezone) {
    const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const firstPassUtcMs = localAsUtcMs - getTimezoneOffsetMs(localAsUtcMs, timezone);
    return localAsUtcMs - getTimezoneOffsetMs(firstPassUtcMs, timezone);
}

function parseRecordingFilenameTimestampMs(filename, timezone) {
    const match = String(filename || '').match(FILENAME_RE);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second] = match.map(Number);
    return localPartsToUtcMs({ year, month, day, hour, minute, second }, timezone);
}

function getFileMtimeMs(filePath) {
    if (!filePath || !existsSync(filePath)) {
        return null;
    }

    try {
        return statSync(filePath).mtimeMs;
    } catch {
        return null;
    }
}

function shouldRepairRow({ currentStartMs, repairedStartMs, fileMtimeMs, nowMs }) {
    if (!Number.isFinite(currentStartMs) || !Number.isFinite(repairedStartMs)) {
        return false;
    }

    const shiftedByAtLeastOneHour = Math.abs(currentStartMs - repairedStartMs) > ONE_HOUR_MS;
    if (!shiftedByAtLeastOneHour) {
        return false;
    }

    if (Number.isFinite(fileMtimeMs)) {
        return Math.abs(repairedStartMs - fileMtimeMs) + ONE_MINUTE_MS < Math.abs(currentStartMs - fileMtimeMs);
    }

    return currentStartMs > nowMs + ONE_HOUR_MS && repairedStartMs <= nowMs + FIFTEEN_MINUTES_MS;
}

try {
    if (!tableExists('recording_segments')) {
        console.log('recording_segments table does not exist yet; skipping recording timezone repair');
        process.exit(0);
    }

    const timezone = getConfiguredTimezone();
    const nowMs = Date.now();
    const rows = db.prepare(`
        SELECT id, filename, start_time, end_time, duration, file_path
        FROM recording_segments
    `).all();
    const updates = [];

    for (const row of rows) {
        const repairedStartMs = parseRecordingFilenameTimestampMs(row.filename, timezone);
        const currentStartMs = Date.parse(row.start_time);
        const fileMtimeMs = getFileMtimeMs(row.file_path);

        if (!shouldRepairRow({ currentStartMs, repairedStartMs, fileMtimeMs, nowMs })) {
            continue;
        }

        const currentEndMs = Date.parse(row.end_time);
        const durationSeconds = Number(row.duration);
        const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0
            ? Math.round(durationSeconds * 1000)
            : currentEndMs - currentStartMs;
        const repairedEndMs = Number.isFinite(durationMs) && durationMs > 0
            ? repairedStartMs + durationMs
            : repairedStartMs;

        updates.push({
            startTime: new Date(repairedStartMs).toISOString(),
            endTime: new Date(repairedEndMs).toISOString(),
            id: row.id,
        });
    }

    const applyUpdates = db.transaction((items) => {
        const update = db.prepare(`
            UPDATE recording_segments
            SET start_time = ?, end_time = ?
            WHERE id = ?
        `);
        for (const item of items) {
            update.run(item.startTime, item.endTime, item.id);
        }
    });

    applyUpdates(updates);
    console.log(`Recording timezone repair complete: ${updates.length} row(s) updated using ${timezone}`);
} finally {
    db.close();
}
