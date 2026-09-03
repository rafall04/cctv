/**
 * Purpose: One-time DATA migration — shift the viewer/playback SESSION timestamps that were written
 *          in the configured display tz (WIB, +7) over to the canonical UTC convention the rest of
 *          the DB uses, now that the code writes UTC. Event wall-clock columns only.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js (runs after the code deploy).
 * Deps: better-sqlite3, backend/data/cctv.db, system_settings (timezone + the marker).
 * MainFuncs: migration script body.
 * SideEffects: UPDATEs started_at/last_heartbeat/ended_at in the session + history (+archive) tables,
 *              shifting each by the configured offset; writes an idempotency marker. IDEMPOTENT and
 *              REVERSIBLE (see the marker), guarded so a re-run is a no-op.
 *
 * SCOPE / DELIBERATE EXCLUSIONS (see the 2026-09-03 time-consistency audit):
 *  - cameras.last_online_check: NOT migrated. It is rewritten every health tick, so it self-heals to
 *    UTC within minutes of the deploy; bulk-shifting it would risk double-shifting rows the new code
 *    already rewrote as UTC in the deploy gap.
 *  - camera_view_stats.*: NOT migrated. Mixed WIB/UTC provenance (indistinguishable) + it is a
 *    passthrough display value, never compared/bucketed; new UTC writes self-heal it.
 *  - archived_at / created_at (DEFAULT CURRENT_TIMESTAMP) and segment_started_at (UTC ISO): already
 *    UTC — never touched.
 *  - duration_seconds: an integer diff — tz-agnostic.
 *
 * DEPLOY-GAP NOTE: any session row written by the OLD code in the seconds between deploy and this
 * migration stays in WIB (append-only history is immutable, so no double-shift). Negligible for these
 * low-volume analytics tables; the marker prevents any re-run from shifting twice.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const dbPath = resolveDbPath();
const db = new Database(dbPath);

const MARKER_KEY = 'viewer_tz_utc_migration';

// Event wall-clock columns to shift, per table. Only bare 'YYYY-MM-DD HH:MM:SS' values are touched.
const TARGETS = [
    { table: 'viewer_sessions', columns: ['started_at', 'last_heartbeat', 'ended_at'] },
    { table: 'viewer_session_history', columns: ['started_at', 'ended_at'] },
    { table: 'viewer_session_history_archive', columns: ['started_at', 'ended_at'] },
    { table: 'playback_viewer_sessions', columns: ['started_at', 'last_heartbeat', 'ended_at'] },
    { table: 'playback_viewer_session_history', columns: ['started_at', 'ended_at'] },
    { table: 'playback_viewer_session_history_archive', columns: ['started_at', 'ended_at'] },
];

function tableExists(name) {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function ensureSystemSettings() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS system_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT UNIQUE NOT NULL,
            setting_value TEXT NOT NULL
        )
    `);
}

function getConfiguredTimezone() {
    try {
        const row = db.prepare("SELECT setting_value FROM system_settings WHERE setting_key='timezone'").get();
        return row?.setting_value || 'Asia/Jakarta';
    } catch {
        return 'Asia/Jakarta';
    }
}

/** Minutes east of UTC for `timezone` at the current instant (Asia/Jakarta → 420). */
function offsetMinutes(timezone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
            .formatToParts(new Date());
        const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+0';
        const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
        if (!m) return 0;
        return (m[1] === '-' ? -1 : 1) * (Number.parseInt(m[2], 10) * 60 + Number.parseInt(m[3] || '0', 10));
    } catch {
        return 0;
    }
}

console.log('Running migration: zz_20260903_utc_viewer_timestamps');
console.log('Database path:', dbPath);

try {
    ensureSystemSettings();

    const already = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key=?').get(MARKER_KEY);
    if (already) {
        console.log(`  = already applied (${already.setting_value}) — no-op`);
    } else {
        const timezone = getConfiguredTimezone();
        const offset = offsetMinutes(timezone);

        if (offset === 0) {
            // Server tz already UTC (or unresolved) — nothing to shift, but stamp the marker so a
            // later tz change never retro-shifts these rows.
            db.prepare('INSERT OR REPLACE INTO system_settings (setting_key, setting_value) VALUES (?, ?)')
                .run(MARKER_KEY, JSON.stringify({ appliedAt: new Date().toISOString(), timezone, offsetMinutes: 0, note: 'offset 0 — no shift' }));
            console.log(`  = configured tz ${timezone} has 0 offset — marker set, no rows shifted`);
        } else {
            // WIB→UTC = local minus offset. `datetime(col, '<mod> minutes')` keeps the bare format.
            const shiftMod = `${offset <= 0 ? '+' : '-'}${Math.abs(offset)} minutes`;
            const BARE = "____-__-__ __:__:__%"; // matches 'YYYY-MM-DD HH:MM:SS' (with optional .frac)

            const apply = db.transaction(() => {
                let totalRows = 0;
                for (const { table, columns } of TARGETS) {
                    if (!tableExists(table)) {
                        console.log(`  · ${table}: (absent, skipped)`);
                        continue;
                    }
                    for (const col of columns) {
                        const before = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
                        const res = db.prepare(
                            `UPDATE ${table} SET ${col} = datetime(${col}, ?) WHERE ${col} IS NOT NULL AND ${col} LIKE ?`
                        ).run(shiftMod, BARE);
                        const after = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
                        // A shift must never change cardinality — abort the whole tx if it somehow did.
                        if (before !== after) {
                            throw new Error(`row count changed on ${table} (${before} -> ${after}) — aborting`);
                        }
                        totalRows += res.changes;
                        console.log(`  + ${table}.${col}: shifted ${res.changes} rows by ${shiftMod}`);
                    }
                }
                db.prepare('INSERT OR REPLACE INTO system_settings (setting_key, setting_value) VALUES (?, ?)')
                    .run(MARKER_KEY, JSON.stringify({ appliedAt: new Date().toISOString(), timezone, offsetMinutes: offset, shift: shiftMod, rows: totalRows }));
                return totalRows;
            });

            const shifted = apply();
            console.log(`  ✓ shifted ${shifted} timestamp values from ${timezone} (${offset >= 0 ? '+' : ''}${offset}m) to UTC`);
        }
    }

    console.log('Migration complete: zz_20260903_utc_viewer_timestamps');
} catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
