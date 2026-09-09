/*
 * Purpose: Per-camera "audio blocked" flag — a HARD exclusion from every Audio Broadcast code path
 *          (probe, sweep, target list, play, live talk). Some cheap cameras (V380-class, RTSP path
 *          /onvif1) will HANG THEMSELVES if they receive an unexpected ONVIF DESCRIBE/backchannel, so
 *          they must never be touched by audio — not even the silent capability probe.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds cameras.audio_out_blocked; auto-blocks known-dangerous V380-signature cameras.
 * SideEffects: schema + one bounded UPDATE; additive + idempotent (PRAGMA guard + WHERE blocked=0).
 *
 * Auto-block is surgical: only cameras whose internal RTSP path is /onvif1 or /onvif2 (the V380
 * signature). On this fleet that matches exactly one camera ("PERTIGAAN GG ALANG ALANG KEMANGI",
 * 192.168.12.4/onvif1) and never the working IMOU cameras (path /cam/realmonitor). An operator can
 * block/unblock any camera from the "Kamera & Area" tab afterwards.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add cameras.audio_out_blocked (+ auto-block V380)...');

try {
    const has = db.prepare('PRAGMA table_info(cameras)').all().some((c) => c.name === 'audio_out_blocked');
    if (!has) {
        db.exec('ALTER TABLE cameras ADD COLUMN audio_out_blocked INTEGER NOT NULL DEFAULT 0');
        console.log('  + added cameras.audio_out_blocked (DEFAULT 0)');
    } else {
        console.log('  = cameras.audio_out_blocked already present');
    }

    // Surgically auto-block V380-signature cameras (RTSP path /onvif1 or /onvif2). Idempotent: only rows
    // still unblocked are touched, so re-running (or an operator unblocking on purpose) is respected.
    const info = db.prepare(`
        UPDATE cameras
        SET audio_out_blocked = 1,
            audio_out_note = 'Diblokir otomatis: perangkat tipe V380 (RTSP /onvif) rawan hang saat di-probe/siaran'
        WHERE stream_source = 'internal'
          AND audio_out_blocked = 0
          AND (private_rtsp_url LIKE '%/onvif1%' OR private_rtsp_url LIKE '%/onvif2%')
    `).run();
    console.log(`  + auto-blocked ${info.changes} V380-signature camera(s)`);

    console.log('Camera audio-block migration completed successfully');
} catch (error) {
    console.error('Camera audio-block migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
