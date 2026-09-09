/*
 * Purpose: Persist per-camera ONVIF audio-out (backchannel speaker) capability, populated ONLY by the
 *          silent DESCRIBE probe (audio_probe.py / audioCapabilityService) — never by hand.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds cameras.supports_audio_out, audio_out_checked_at, audio_out_note.
 * SideEffects: schema only; additive + idempotent (PRAGMA table_info guard).
 *
 * TRI-STATE, NO DEFAULT (deliberate). supports_audio_out: NULL = never probed / unknown, 0 = reachable +
 * authed but no usable backchannel track (S41FE-class, or a sendonly track the pusher can't SETUP),
 * 1 = the pusher (SETUP trackID=5 + PCMU/16000) will make sound. The MISSING default is the point:
 * a DEFAULT would make every un-probed row lie (the video_codec `DEFAULT 'H264'` incident). Values arrive
 * only from a real probe; audio_out_checked_at stamps freshness; audio_out_note carries safe-enum evidence.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding audio-out capability columns to cameras table...');
    const cols = db.prepare('PRAGMA table_info(cameras)').all().map((c) => c.name);
    const add = (name, ddl) => {
        if (cols.includes(name)) {
            console.log(`  = cameras.${name} already present`);
        } else {
            db.exec(`ALTER TABLE cameras ADD COLUMN ${ddl}`);
            console.log(`  + added cameras.${name}`);
        }
    };

    add('supports_audio_out', 'supports_audio_out INTEGER');   // NULL/0/1, NO DEFAULT on purpose
    add('audio_out_checked_at', 'audio_out_checked_at TEXT');  // ISO ts of last conclusive probe
    add('audio_out_note', 'audio_out_note TEXT');              // safe-enum evidence, e.g. 'sendonly trackID=5 PCMU/16000'

    console.log('Camera audio-out capability migration completed successfully');
} catch (error) {
    console.error('Camera audio-out capability migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
