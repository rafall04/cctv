/*
 * Purpose: Store the (optional) cloud TTS API key entered from the admin UI — currently the Google
 *          Gemini AI Studio key — so a non-technical operator can enable the natural Gemini voice
 *          WITHOUT editing .env over SSH. Single-row table (id=1), mirrors audio_imou_config. The key
 *          stays server-side (masked in the API); env AUDIO_GEMINI_API_KEY remains a fallback.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates audio_tts_config + seeds the single row (id=1).
 * SideEffects: schema + one seed row; additive + idempotent.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Creating audio_tts_config...');
    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_tts_config (
            id              INTEGER PRIMARY KEY CHECK (id = 1),
            gemini_api_key  TEXT,
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    db.exec('INSERT OR IGNORE INTO audio_tts_config (id) VALUES (1)');
    console.log('audio_tts_config migration completed successfully');
} catch (error) {
    console.error('audio_tts_config migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
