/*
 * Purpose: "Import from link" for Audio Broadcast — record where a clip came from, and a durable async
 *          job queue for URL/YouTube imports (extraction is slow, so it runs off the request path).
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds audio_clips.source_* columns; creates audio_import_jobs.
 * SideEffects: schema only; additive + idempotent (PRAGMA guard + CREATE TABLE IF NOT EXISTS).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding audio import schema...');
    const cols = db.prepare('PRAGMA table_info(audio_clips)').all().map((c) => c.name);
    const add = (name, ddl) => {
        if (cols.includes(name)) { console.log(`  = audio_clips.${name} already present`); }
        else { db.exec(`ALTER TABLE audio_clips ADD COLUMN ${ddl}`); console.log(`  + added audio_clips.${name}`); }
    };
    add('source_type', "source_type TEXT NOT NULL DEFAULT 'upload'"); // 'upload' | 'url' | 'youtube'
    add('source_url', 'source_url TEXT');
    add('source_title', 'source_title TEXT');

    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_import_jobs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            source_url   TEXT    NOT NULL,
            source_kind  TEXT    NOT NULL DEFAULT 'url',   -- 'url' | 'youtube'
            requested_name TEXT,
            status       TEXT    NOT NULL DEFAULT 'queued', -- queued | processing | ready | failed
            clip_id      INTEGER,
            title        TEXT,
            duration_sec REAL,
            error        TEXT,
            attempts     INTEGER NOT NULL DEFAULT 0,
            created_by   INTEGER,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            started_at   TEXT,
            finished_at  TEXT,
            FOREIGN KEY (clip_id) REFERENCES audio_clips(id) ON DELETE SET NULL
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_audio_import_jobs_status ON audio_import_jobs(status)');

    console.log('Audio import migration completed successfully');
} catch (error) {
    console.error('Audio import migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
