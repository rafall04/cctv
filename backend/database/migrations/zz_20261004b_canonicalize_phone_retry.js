/*
 * Purpose: RETRY of zz_20261004_canonicalize_phone.js — that run was a silent no-op: on tables
 *          whose PK is an INTEGER PRIMARY KEY rowid-alias, `SELECT rowid` returns the column
 *          under the alias name ('id'), so `row.rowid` was undefined and every UPDATE matched
 *          `WHERE rowid = NULL`. The unique index WAS still created, so this pass also guards
 *          per-row against canonical-form collisions (a pre-existing '0xxx' twin wins; the
 *          legacy row keeps its spelling and app-level variant matching still resolves it).
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db, utils/phoneNumber.js.
 * MainFuncs: normalize phone columns in place (0xxx canonical form).
 * SideEffects: rewrites phone spellings (equivalent numbers). IDEMPOTENT: canonical rows skip.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { normalizePhone } from '../../utils/phoneNumber.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: canonicalize phone numbers (rowid-alias retry)...');

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
    const collisions = [];
    const normalizeAll = db.transaction(() => {
        for (const [table, column] of PHONE_COLUMNS) {
            if (!hasColumn(table, column)) continue;
            const rows = db.prepare(
                `SELECT rowid AS __mig_rowid, ${column} AS phone FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`
            ).all();
            const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
            const clash = db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? AND rowid != ?`);
            let changed = 0;
            for (const row of rows) {
                const canonical = normalizePhone(row.phone);
                if (!canonical || canonical === row.phone) continue;
                if (clash.get(canonical, row.__mig_rowid)) {
                    collisions.push(`${table}.${column} rowid=${row.__mig_rowid}`);
                    continue;
                }
                changed += update.run(canonical, row.__mig_rowid).changes;
            }
            if (changed > 0) console.log(`   ${table}.${column}: ${changed} row(s) canonicalized`);
        }
    });
    normalizeAll();

    if (collisions.length > 0) {
        console.warn(`   ${collisions.length} row(s) kept verbatim — canonical twin already exists:`, collisions.join(', '));
    }
    console.log('Phone canonicalization retry completed successfully');
} catch (error) {
    console.error('Phone canonicalization retry failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
