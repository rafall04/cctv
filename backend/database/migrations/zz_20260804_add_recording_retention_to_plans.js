// Purpose: Let each rental plan state how many days of recording it actually includes.
// Caller: npm run migrate.
// Deps: better-sqlite3 database file, billing_plans table.
// MainFuncs: none (script).
// SideEffects: Adds billing_plans.recording_retention_days when missing. Idempotent.
//
// WHY
// ---
// The catalog could charge a recording surcharge but had no way to say how long the
// recording is kept. Selling "rekaman" without a duration is the part a customer would
// rightly call dishonest — and the owner flagged it before a single client was sent the
// price list. So the depth becomes a plan property, editable in the panel and published
// on the price list next to the surcharge that pays for it.
//
// DEFAULT 0 = "belum ditentukan", NOT "zero days"
// ----------------------------------------------
// Existing plans keep promising nothing rather than silently acquiring a number nobody
// chose. Both the panel and the public page render 0 as "belum ditetapkan" instead of
// "0 hari", because a wrong duration is worse than an absent one. The owner fills it in
// once, deliberately.

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();
const db = new Database(dbPath);

try {
    const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='billing_plans'")
        .get();

    if (!table) {
        console.log('billing_plans not present yet; skipping retention migration');
    } else {
        const already = db
            .prepare('PRAGMA table_info(billing_plans)')
            .all()
            .some((c) => c.name === 'recording_retention_days');

        if (already) {
            console.log('billing_plans.recording_retention_days already present');
        } else {
            db.exec(`
                ALTER TABLE billing_plans
                ADD COLUMN recording_retention_days INTEGER NOT NULL DEFAULT 0
            `);
            console.log('billing_plans.recording_retention_days added (default 0 = belum ditetapkan)');
        }
    }
} catch (error) {
    console.error('recording retention migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
