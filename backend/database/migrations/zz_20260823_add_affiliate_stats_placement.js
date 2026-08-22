/*
Purpose: Count affiliate impressions and clicks PER SURFACE, so "25 shown under the live video, 8 on
         the area page" is answerable instead of one blended number.
Caller: run-all-migrations (filename order).
Deps: better-sqlite3 against backend/data/cctv.db.
SideEffects: REBUILDS affiliate_offer_stats to widen its UNIQUE key. Idempotent.

WHY A REBUILD AND NOT AN ALTER
------------------------------
The old key is `UNIQUE (offer_id, stat_date)`, declared as a TABLE CONSTRAINT. SQLite backs that
with an implicit index that `DROP INDEX` cannot touch and `ALTER TABLE` cannot redefine, so adding
`placement` to the key means building the table again and copying the rows across. That is the
documented SQLite procedure, not a workaround.

This table holds real production counts (62 impressions, 8 product clicks at the time of writing),
so the copy is the part that matters. Every existing row is stamped `placement = 'popup'`, which is
not a guess: the under-video slot was the only surface wired until this change, so every count that
exists was earned there.

WHY THE COUNTS HAD TO SPLIT
---------------------------
Once one offer can appear under the live video AND on the area page AND on the landing page, a
single visitor browsing landing → area → camera would add three impressions to one number. Blended,
a rising figure could mean "this product is interesting" or merely "we put it in more places" — and
those call for opposite decisions. Split, the operator can see which surface actually works before
selling it to a partner.

`placement` is NOT NULL with no default on purpose: a writer that forgets to say where a count came
from should fail loudly here rather than quietly pile everything into one bucket, which is the
failure this migration exists to end.

SAFETY
------
Wrapped in a transaction with an explicit rollback, and foreign_keys is suspended for the swap so
the drop-and-rename cannot trip the FK that points at affiliate_offers. safe-deploy.sh backs up
data/cctv.db before migrations run; keep that copy until the new counts look right.
*/

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

function tableExists(name) {
    return Boolean(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name)
    );
}

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

try {
    if (!tableExists('affiliate_offer_stats')) {
        console.log('affiliate_offer_stats not present yet — nothing to rebuild');
    } else if (hasColumn('affiliate_offer_stats', 'placement')) {
        console.log('affiliate_offer_stats.placement already present');
    } else {
        const before = db.prepare('SELECT COUNT(*) AS n FROM affiliate_offer_stats').get().n;

        // Must sit OUTSIDE the transaction — SQLite ignores a foreign_keys change inside one.
        db.pragma('foreign_keys = OFF');
        db.exec('BEGIN');

        db.exec(`
            CREATE TABLE affiliate_offer_stats_rebuilt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                offer_id INTEGER NOT NULL,
                stat_date TEXT NOT NULL,
                placement TEXT NOT NULL,
                impressions INTEGER NOT NULL DEFAULT 0,
                product_clicks INTEGER NOT NULL DEFAULT 0,
                store_clicks INTEGER NOT NULL DEFAULT 0,
                whatsapp_clicks INTEGER NOT NULL DEFAULT 0,
                UNIQUE (offer_id, stat_date, placement),
                FOREIGN KEY (offer_id) REFERENCES affiliate_offers(id) ON DELETE CASCADE
            )
        `);

        // 'popup' is the truth, not a placeholder — see the header.
        db.exec(`
            INSERT INTO affiliate_offer_stats_rebuilt
                (id, offer_id, stat_date, placement, impressions, product_clicks, store_clicks, whatsapp_clicks)
            SELECT id, offer_id, stat_date, 'popup', impressions, product_clicks, store_clicks, whatsapp_clicks
            FROM affiliate_offer_stats
        `);

        const copied = db.prepare('SELECT COUNT(*) AS n FROM affiliate_offer_stats_rebuilt').get().n;
        if (copied !== before) {
            throw new Error(`row count changed during rebuild: ${before} -> ${copied}`);
        }

        db.exec('DROP TABLE affiliate_offer_stats');
        db.exec('ALTER TABLE affiliate_offer_stats_rebuilt RENAME TO affiliate_offer_stats');
        db.exec('CREATE INDEX IF NOT EXISTS idx_affiliate_stats_date ON affiliate_offer_stats(stat_date)');

        db.exec('COMMIT');
        db.pragma('foreign_keys = ON');

        // Cheap proof the FKs still line up after a drop-and-rename, since that is exactly what
        // suspending them could have hidden.
        const violations = db.pragma('foreign_key_check(affiliate_offer_stats)');
        if (violations.length > 0) {
            console.error(`foreign_key_check found ${violations.length} violation(s) after rebuild`);
            process.exitCode = 1;
        } else {
            console.log(`Rebuilt affiliate_offer_stats with placement (${before} row(s) preserved, stamped 'popup')`);
        }
    }
} catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
    try { db.pragma('foreign_keys = ON'); } catch { /* best effort */ }
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
