// Purpose: Record when a camera was last actually ONLINE, so billing can tell a working day
//          apart from a dead one.
// Caller: npm run migrate.
// Deps: better-sqlite3 database file, camera_runtime_state table.
// MainFuncs: none (script).
// SideEffects: Adds camera_runtime_state.last_online_at when missing. Idempotent.
//
// WHY A NEW COLUMN INSTEAD OF REUSING WHAT EXISTS
// -----------------------------------------------
// `cameras.last_online_check` looks like the right field and is not: its UPDATE passes the
// literal 1 as the last parameter, so the `? = 1` guard is always true and the column is
// refreshed on EVERY health check — online or offline. It records when we last looked, not
// when the camera last worked. Billing on that would charge a dead camera forever.
//
// `camera_runtime_state.is_online` is a current snapshot, which answers "is it up right now",
// not "did it work at all today" — and the daily charge runs at one arbitrary moment, so a
// snapshot would hand out free days to cameras that were up all day and bill cameras that
// happened to blink at the wrong second.
//
// NULL means "never seen online", which billing must treat as not-working rather than as
// working — a camera that has never once come up has never delivered the service.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='camera_runtime_state'")
        .get();

    if (!table) {
        console.log('camera_runtime_state not present yet; skipping last_online_at migration');
    } else {
        const already = db
            .prepare('PRAGMA table_info(camera_runtime_state)')
            .all()
            .some((c) => c.name === 'last_online_at');

        if (already) {
            console.log('camera_runtime_state.last_online_at already present');
        } else {
            db.exec('ALTER TABLE camera_runtime_state ADD COLUMN last_online_at TEXT');
            // Cameras currently up are seeded so the first billing run after deploy does not
            // treat a healthy fleet as dead and hand out a free day to everyone.
            const seeded = db.prepare(
                "UPDATE camera_runtime_state SET last_online_at = COALESCE(last_health_check_at, updated_at) WHERE is_online = 1"
            ).run();
            console.log(`camera_runtime_state.last_online_at added (${seeded.changes} kamera online diberi nilai awal)`);
        }
    }
} catch (error) {
    console.error('last_online_at migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
