/*
 * Purpose: Clip organisation for Audio Broadcast — category, favourite flag, and free tags on a clip so
 *          an operator can find the right announcement fast in a growing library. Data-only (the picker/
 *          library filter on these); no behaviour change to playback.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds audio_clips.category / is_favorite / tags.
 * SideEffects: schema only; additive + idempotent (PRAGMA guard). Nullable/zero defaults — the safe kind
 *   (no "claim of truth" default like a codec column would carry).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding audio_clips organisation columns...');
    const cols = db.prepare('PRAGMA table_info(audio_clips)').all().map((c) => c.name);
    const add = (name, ddl) => {
        if (cols.includes(name)) { console.log(`  = audio_clips.${name} already present`); }
        else { db.exec(`ALTER TABLE audio_clips ADD COLUMN ${ddl}`); console.log(`  + added audio_clips.${name}`); }
    };
    add('category', 'category TEXT');
    add('is_favorite', 'is_favorite INTEGER NOT NULL DEFAULT 0');
    add('tags', 'tags TEXT'); // comma-separated, optional

    console.log('Audio clip meta migration completed successfully');
} catch (error) {
    console.error('Audio clip meta migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
