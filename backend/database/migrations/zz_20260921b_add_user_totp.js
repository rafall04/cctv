/*
 * Purpose: Per-user TOTP two-factor columns on `users` — secret at rest, enable flag,
 *          recovery-code hashes, and a dedicated challenge lockout counter.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds users.totp_secret/totp_enabled/totp_confirmed_at/totp_recovery_hashes/
 *            totp_failed_attempts/totp_locked_until.
 * SideEffects: schema only — additive + idempotent (PRAGMA guards).
 *
 * totp_secret stores the AES-256-GCM-encrypted base32 seed (never plaintext): the daily
 * Telegram DB backup ships this table off-box, so a leaked backup must not hand out live
 * TOTP generators. totp_recovery_hashes stores SHA-256 digests of the one-time codes.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add users TOTP columns...');

const COLUMNS = [
    "totp_secret TEXT",                 // AES-256-GCM blob (base64), pending OR active
    "totp_enabled INTEGER NOT NULL DEFAULT 0",
    "totp_confirmed_at TEXT",           // when the enrollment code verified
    "totp_recovery_hashes TEXT",        // JSON array of sha256 digests (one-time use)
    "totp_failed_attempts INTEGER NOT NULL DEFAULT 0",
    "totp_locked_until TEXT",           // challenge lockout, independent of password lockout
];

try {
    const existing = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
    for (const def of COLUMNS) {
        const name = def.split(' ')[0];
        if (existing.has(name)) {
            console.log(`  = users.${name} already present`);
        } else {
            db.exec(`ALTER TABLE users ADD COLUMN ${def}`);
            console.log(`  + added users.${name}`);
        }
    }
    console.log('Migration complete: users TOTP columns');
} finally {
    db.close();
}
