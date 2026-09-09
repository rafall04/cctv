/*
 * Purpose: Text-to-Speech for Audio Broadcast — turn typed text into a spoken clip (natural neural voice,
 *          NOT robotic espeak). Reuses the audio_import_jobs async queue (synthesis is off the request
 *          path, same as URL/YouTube import). Adds the text + engine + voice a TTS job needs.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds audio_import_jobs.tts_text / tts_provider / tts_voice.
 * SideEffects: schema only; additive + idempotent (PRAGMA guard).
 *
 * A TTS job carries source_kind='tts' and a placeholder source_url ('tts') to satisfy the existing
 * NOT NULL column; the real content lives in the tts_* columns. Providers: 'piper' (offline neural,
 * default) and 'edge' (Microsoft Edge neural voices via edge-tts — free, natural, needs internet).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding audio TTS columns...');
    const cols = db.prepare('PRAGMA table_info(audio_import_jobs)').all().map((c) => c.name);
    const add = (name, ddl) => {
        if (cols.includes(name)) { console.log(`  = audio_import_jobs.${name} already present`); }
        else { db.exec(`ALTER TABLE audio_import_jobs ADD COLUMN ${ddl}`); console.log(`  + added audio_import_jobs.${name}`); }
    };
    add('tts_text', 'tts_text TEXT');
    add('tts_provider', 'tts_provider TEXT');   // 'piper' | 'edge'
    add('tts_voice', 'tts_voice TEXT');

    console.log('Audio TTS migration completed successfully');
} catch (error) {
    console.error('Audio TTS migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
