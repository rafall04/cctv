/*
 * Purpose: Scheduled TTS — a schedule can be a spoken-TEXT template instead of a pre-rendered clip, so
 *          dynamic placeholders ({jam}/{hari}/{tanggal}) are synthesized with the CURRENT time AT FIRE,
 *          not baked when the schedule was created. Stores the template text + engine/voice + a pointer to
 *          the last auto-rendered clip (for stale cleanup across restarts).
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds tts_text / tts_engine / tts_voice / tts_clip_id to audio_schedules.
 * SideEffects: schema only; additive + idempotent (PRAGMA guard). source_type gains a 'tts' value at runtime.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding scheduled-TTS columns to audio_schedules...');
    const cols = db.prepare('PRAGMA table_info(audio_schedules)').all().map((c) => c.name);
    if (cols.length === 0) {
        console.log('  ? audio_schedules not present, skip');
    } else {
        const add = (name, ddl) => {
            if (cols.includes(name)) { console.log(`  = audio_schedules.${name} already present`); return; }
            db.exec(`ALTER TABLE audio_schedules ADD COLUMN ${ddl}`);
            console.log(`  + added audio_schedules.${name}`);
        };
        add('tts_text', 'tts_text TEXT');
        add('tts_engine', 'tts_engine TEXT');
        add('tts_voice', 'tts_voice TEXT');
        add('tts_clip_id', 'tts_clip_id INTEGER');
    }
    console.log('Scheduled-TTS migration completed successfully');
} catch (error) {
    console.error('Scheduled-TTS migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
