/**
 * Purpose: Pin the playback-token RENEWAL core — exactly-once per order, correct expiry math (from the
 *          later of current-expiry/now), revoked/missing guards, and access-code lookup.
 * Caller: Backend Vitest suite for services/playbackTokenRenewalService.js.
 * Deps: vitest; real in-memory better-sqlite3 via mocked connectionPool; playbackTokenService audit mocked.
 * SideEffects: None (in-memory DB).
 */
import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await (async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
})();

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(...params),
    queryOne: (sql, params = []) => db.prepare(sql).get(...params),
    execute: (sql, params = []) => {
        const info = db.prepare(sql).run(...params);
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    },
    transaction: (fn) => db.transaction(fn),
}));

const recordAudit = vi.fn();
vi.mock('../services/playbackTokenService.js', () => ({ default: { recordAudit: (...a) => recordAudit(...a) } }));

const renewal = (await import('../services/playbackTokenRenewalService.js')).default;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function seedToken({ id = 1, expiresAt = null, revokedAt = null, code = null } = {}) {
    db.prepare(
        `INSERT INTO playback_tokens (id, expires_at, revoked_at, share_key_hash, share_key_prefix, scope_type, playback_window_hours, label)
         VALUES (?, ?, ?, ?, ?, 'all', 72, 'Paket')`,
    ).run(id, expiresAt, revokedAt, code ? sha(code) : null, code || null);
}

beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS playback_tokens; DROP TABLE IF EXISTS playback_token_renewals');
    db.exec(`CREATE TABLE playback_tokens (
        id INTEGER PRIMARY KEY, expires_at TEXT, revoked_at TEXT, share_key_hash TEXT, share_key_prefix TEXT,
        scope_type TEXT, playback_window_hours INTEGER, playback_from TEXT, playback_to TEXT, label TEXT, updated_at TEXT)`);
    db.exec(`CREATE TABLE playback_token_renewals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER UNIQUE, token_id INTEGER NOT NULL, days_added INTEGER NOT NULL,
        previous_expires_at TEXT, new_expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    recordAudit.mockReset();
});
afterEach(() => vi.clearAllMocks());

const expiryOf = (id) => db.prepare('SELECT expires_at FROM playback_tokens WHERE id = ?').get(id).expires_at;
const ledgerCount = (orderId) => db.prepare('SELECT COUNT(*) n FROM playback_token_renewals WHERE order_id = ?').get(orderId).n;

describe('renewToken — expiry math', () => {
    it('adds days to a FUTURE expiry (stacks onto remaining time)', () => {
        const future = db.prepare("SELECT datetime('now','+10 days') AS d").get().d;
        seedToken({ expiresAt: future });
        const expected = db.prepare("SELECT datetime(?, '+7 days') AS d").get(future).d;
        const res = renewal.renewToken(1, 7, { orderId: 100 });
        expect(res.alreadyRenewed).toBe(false);
        expect(res.newExpiresAt).toBe(expected);
        expect(expiryOf(1)).toBe(expected);
    });

    it('restarts from NOW for an already-EXPIRED token (no stacking dead time)', () => {
        const past = db.prepare("SELECT datetime('now','-5 days') AS d").get().d;
        seedToken({ expiresAt: past });
        const res = renewal.renewToken(1, 30, { orderId: 101 });
        const fromNow = db.prepare("SELECT datetime('now','+30 days') AS d").get().d;
        // within a second of now+30d (clock ticked between the two SQLite calls)
        expect(Math.abs(new Date(res.newExpiresAt + 'Z') - new Date(fromNow + 'Z'))).toBeLessThan(2000);
    });

    it('treats a never-expiring token as base = now', () => {
        seedToken({ expiresAt: null });
        const res = renewal.renewToken(1, 3, { orderId: 102 });
        expect(res.previousExpiresAt).toBeNull();
        expect(new Date(res.newExpiresAt + 'Z').getTime()).toBeGreaterThan(Date.now());
    });
});

describe('renewToken — exactly-once per order', () => {
    it('a replay for the SAME order does not extend twice', () => {
        const future = db.prepare("SELECT datetime('now','+10 days') AS d").get().d;
        seedToken({ expiresAt: future });
        const first = renewal.renewToken(1, 7, { orderId: 200 });
        const afterFirst = expiryOf(1);
        const second = renewal.renewToken(1, 7, { orderId: 200 });
        expect(first.alreadyRenewed).toBe(false);
        expect(second.alreadyRenewed).toBe(true);
        expect(expiryOf(1)).toBe(afterFirst);          // unchanged
        expect(second.newExpiresAt).toBe(afterFirst);  // reports the original result
        expect(ledgerCount(200)).toBe(1);              // exactly one ledger row
    });

    it('a DIFFERENT order extends again', () => {
        const future = db.prepare("SELECT datetime('now','+10 days') AS d").get().d;
        seedToken({ expiresAt: future });
        renewal.renewToken(1, 7, { orderId: 300 });
        const afterFirst = expiryOf(1);
        const res = renewal.renewToken(1, 7, { orderId: 301 });
        expect(res.alreadyRenewed).toBe(false);
        expect(new Date(res.newExpiresAt + 'Z') > new Date(afterFirst + 'Z')).toBe(true);
    });

    it('audit is written for a real renewal but NOT for a replay', () => {
        seedToken({ expiresAt: db.prepare("SELECT datetime('now','+1 days') AS d").get().d });
        renewal.renewToken(1, 5, { orderId: 400 });
        renewal.renewToken(1, 5, { orderId: 400 });
        expect(recordAudit).toHaveBeenCalledTimes(1);
        expect(recordAudit.mock.calls[0][0]).toMatchObject({ eventType: 'renewed', tokenId: 1 });
    });
});

describe('renewToken — guards', () => {
    it('404 for a missing token', () => {
        expect(() => renewal.renewToken(999, 7, { orderId: 1 })).toThrowError(expect.objectContaining({ statusCode: 404 }));
    });
    it('400 for a revoked token', () => {
        seedToken({ revokedAt: db.prepare("SELECT datetime('now') AS d").get().d });
        expect(() => renewal.renewToken(1, 7, { orderId: 1 })).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });
    it('400 for bad days', () => {
        seedToken({});
        expect(() => renewal.renewToken(1, 0, { orderId: 1 })).toThrowError(expect.objectContaining({ statusCode: 400 }));
        expect(() => renewal.renewToken(1, -3, { orderId: 1 })).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });
    it('admin renewal (orderId null) is allowed and never deduped', () => {
        seedToken({ expiresAt: db.prepare("SELECT datetime('now','+2 days') AS d").get().d });
        const a = renewal.renewToken(1, 1, { orderId: null });
        const b = renewal.renewToken(1, 1, { orderId: null });
        expect(a.alreadyRenewed).toBe(false);
        expect(b.alreadyRenewed).toBe(false); // both applied (NULLs distinct)
        expect(db.prepare('SELECT COUNT(*) n FROM playback_token_renewals').get().n).toBe(2);
    });
});

describe('findTokenByAccessCode', () => {
    it('resolves a token by its access code (hash match)', () => {
        seedToken({ code: 'RAFPB1234' });
        expect(renewal.findTokenByAccessCode('RAFPB1234')?.id).toBe(1);
        expect(renewal.findTokenByAccessCode('  RAFPB1234  ')?.id).toBe(1); // trims
    });
    it('returns null for an unknown / empty code', () => {
        seedToken({ code: 'RAFPB1234' });
        expect(renewal.findTokenByAccessCode('WRONG')).toBeNull();
        expect(renewal.findTokenByAccessCode('')).toBeNull();
        expect(renewal.findTokenByAccessCode(null)).toBeNull();
    });
});
