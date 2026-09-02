// Purpose: Record WHEN a camera's upstream source died, not just that the camera is offline.
// Caller: Backend migration runner (npm run migrate).
// Deps: better-sqlite3 database file, camera_runtime_state table.
// MainFuncs: migration script body.
// SideEffects: Adds two nullable columns when missing. Idempotent.
//
// `monitoring_reason` already said 'stream_ended' or 'http_404', but it is overwritten on every
// health tick, so it could only ever answer "what is wrong right now". The question an operator
// actually has about a third-party feed is "has this been dead long enough that I should chase the
// provider, or did it just blink?" — and that needs a start time, which nothing was keeping.
//
// Six of production's 36 cameras have been dead at the source since 2026-07-31 while presenting
// exactly like a camera that might return in five minutes.

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolveDbPath());

try {
    const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='camera_runtime_state'",
    ).get();
    if (!exists) {
        console.log('camera_runtime_state not present yet; skipping');
        process.exit(0);
    }

    const columns = db.prepare('PRAGMA table_info(camera_runtime_state)').all().map((c) => c.name);
    if (!columns.includes('source_dead_since')) {
        db.exec('ALTER TABLE camera_runtime_state ADD COLUMN source_dead_since TEXT');
        console.log('added source_dead_since');
    }
    // Kept beside the timestamp so the reason that STARTED the streak survives, even though
    // monitoring_reason keeps moving. "404 since Friday" and "ENDLIST since Friday" are different
    // conversations with the provider.
    if (!columns.includes('source_dead_reason')) {
        db.exec('ALTER TABLE camera_runtime_state ADD COLUMN source_dead_reason TEXT');
        console.log('added source_dead_reason');
    }
} catch (error) {
    console.error('source-dead tracking migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
