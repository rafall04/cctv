/*
 * Purpose: One canonical phone form ('0xxx') across users.phone + order/voucher phone columns,
 *          then a partial UNIQUE index on users.phone so "one phone = one account" is enforced
 *          by the database, not just by a check-then-act that '62xxx' spellings bypassed.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db, utils/phoneNumber.js (same rule the services use).
 * MainFuncs: normalize phone columns; CREATE UNIQUE INDEX idx_users_phone_unique (partial).
 * SideEffects: rewrites phone spellings in place (equivalent numbers, not data loss); creates
 *              an index. IDEMPOTENT: re-run skips normalized rows and an existing index.
 *
 * SAFETY: if canonicalizing two rows would collide (same number, different spellings), the
 * duplicate is reported and the unique index is SKIPPED — never a failed migration on a
 * populated DB. Application-layer variant matching still treats them as the same number.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { normalizePhone } from '../../utils/phoneNumber.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: canonicalize phone numbers + users.phone unique index...');

const PHONE_COLUMNS = [
    ['users', 'phone'],
    ['playback_orders', 'buyer_phone'],
    ['voucher_orders', 'buyer_phone'],
    ['voucher_redemptions', 'buyer_phone'],
    ['vouchers', 'buyer_phone'],
];

function hasColumn(table, column) {
    try {
        return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    } catch {
        return false; // table absent on this box — nothing to normalize
    }
}

try {
    const normalizeAll = db.transaction(() => {
        for (const [table, column] of PHONE_COLUMNS) {
            if (!hasColumn(table, column)) continue;
            // `rowid AS __mig_rowid` — plain `SELECT rowid` reports the INTEGER PRIMARY KEY
            // alias column name ('id'), so row.rowid is undefined and the UPDATE silently
            // no-ops on `WHERE rowid = NULL`. The explicit alias keeps the key stable.
            const rows = db.prepare(
                `SELECT rowid AS __mig_rowid, ${column} AS phone FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`
            ).all();
            const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
            let changed = 0;
            for (const row of rows) {
                const canonical = normalizePhone(row.phone);
                if (canonical && canonical !== row.phone) {
                    changed += update.run(canonical, row.__mig_rowid).changes;
                }
            }
            if (changed > 0) console.log(`   ${table}.${column}: ${changed} row(s) canonicalized`);
        }
    });
    normalizeAll();

    const indexExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_phone_unique'"
    ).get();
    if (indexExists) {
        console.log('   idx_users_phone_unique already present — skipped');
    } else {
        const dupes = db.prepare(
            `SELECT phone, COUNT(*) c FROM users WHERE phone IS NOT NULL AND phone != '' GROUP BY phone HAVING c > 1`
        ).all();
        if (dupes.length > 0) {
            console.warn(`   ${dupes.length} duplicate phone(s) found — unique index NOT created; resolve manually:`,
                dupes.map((d) => `${d.phone} x${d.c}`).join(', '));
        } else {
            db.exec(
                `CREATE UNIQUE INDEX idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL AND phone != ''`
            );
            console.log('   idx_users_phone_unique created (partial — NULL/empty phones exempt)');
        }
    }

    console.log('Phone canonicalization migration completed successfully');
} catch (error) {
    console.error('Phone canonicalization migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
