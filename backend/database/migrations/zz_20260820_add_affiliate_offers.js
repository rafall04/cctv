/*
Purpose: Tables for the affiliate feature — a partner shop's product link, store link and
         description shown under a live camera, replacing the house promo on targeted cameras.
Caller: run-all-migrations (filename order).
Deps: better-sqlite3 against backend/data/cctv.db.
SideEffects: CREATE TABLE affiliate_partners / affiliate_offers / affiliate_offer_targets /
             affiliate_offer_stats (+3 indexes). Idempotent; creates nothing that exists.

WHY TWO ENTITIES AND NOT ONE FLAT TABLE
---------------------------------------
The commercial deal is with the SHOP, the content is a PRODUCT, and one shop lists several
products. Flattening them would repeat the shop's name, URL and price on every product row and
make "this shop's deal expired" an UPDATE across rows instead of one. The migration runner here
has no ledger — every file re-runs on every deploy — so a later normalising migration would have
to be written as a backfill against live data. Cheaper to get it right once.

WHY THE PRICE LIVES ON THE PARTNER AND IS INTEGER RUPIAH
--------------------------------------------------------
`price_rupiah INTEGER` — money is INTEGER rupiah, never floating point (a Critical Invariant). The
sponsor tables predate that rule and are explicitly allow-listed in guardrails.test.js; that is the
mistake not to repeat here. 0 is a legitimate, deliberate value: the operator runs their
own shop's promo through the same machinery for free, so this column must never carry a
"paid plans cannot be zero" rule.

`billing_mode` is 'lifetime' or 'term'. Lifetime means end_date IS NULL and the offer never
expires on its own; term means end_date decides. Storing the mode rather than inferring it from
a NULL end_date keeps "this is a lifetime deal" distinguishable from "someone forgot to set the
end date", which matters when an operator is looking at a list of contracts.

WHY TARGETS ARE A TABLE AND NOT A JSON COLUMN
---------------------------------------------
Same shape as promo_banner_targets: the resolver picks ONE offer per viewing context with
SQL ordering (camera beats area beats all), which needs a joinable row per target, not a blob.
*/

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolveDbPath();
const db = new Database(dbPath);

function tableExists(name) {
    return Boolean(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name)
    );
}

try {
    const before = ['affiliate_partners', 'affiliate_offers', 'affiliate_offer_targets', 'affiliate_offer_stats']
        .filter(tableExists);

    db.exec('BEGIN');

    db.exec(`
        CREATE TABLE IF NOT EXISTS affiliate_partners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_name TEXT NOT NULL,
            store_url TEXT,
            contact_note TEXT,
            billing_mode TEXT NOT NULL DEFAULT 'term',
            price_rupiah INTEGER NOT NULL DEFAULT 0,
            start_date TEXT,
            end_date TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS affiliate_offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            partner_id INTEGER NOT NULL,
            product_title TEXT NOT NULL,
            description TEXT,
            product_url TEXT NOT NULL,
            target_mode TEXT NOT NULL DEFAULT 'all',
            placements TEXT NOT NULL DEFAULT '["popup"]',
            priority INTEGER NOT NULL DEFAULT 100,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (partner_id) REFERENCES affiliate_partners(id) ON DELETE CASCADE
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS affiliate_offer_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id INTEGER NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER NOT NULL,
            UNIQUE (offer_id, target_type, target_id),
            FOREIGN KEY (offer_id) REFERENCES affiliate_offers(id) ON DELETE CASCADE
        )
    `);

    /*
     * Daily rollup, not a per-event log: one row per (offer, day). Same trade the promo stats
     * make — an operator wants "how many clicks yesterday", nobody wants 50k event rows on a
     * box whose disk is the real constraint. Product and store links are counted separately
     * because they answer different questions: interest in the item vs interest in the shop.
     */
    db.exec(`
        CREATE TABLE IF NOT EXISTS affiliate_offer_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id INTEGER NOT NULL,
            stat_date TEXT NOT NULL,
            impressions INTEGER NOT NULL DEFAULT 0,
            product_clicks INTEGER NOT NULL DEFAULT 0,
            store_clicks INTEGER NOT NULL DEFAULT 0,
            UNIQUE (offer_id, stat_date),
            FOREIGN KEY (offer_id) REFERENCES affiliate_offers(id) ON DELETE CASCADE
        )
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_affiliate_targets_lookup ON affiliate_offer_targets(target_type, target_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_affiliate_offers_partner ON affiliate_offers(partner_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_affiliate_stats_date ON affiliate_offer_stats(stat_date)');

    db.exec('COMMIT');

    console.log(before.length === 4
        ? 'Affiliate tables already present'
        : `Affiliate tables ready (created: ${4 - before.length})`);
} catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
