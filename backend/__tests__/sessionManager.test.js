/**
 * Purpose: Lock down session/token management — fingerprint binding, token pair, blacklist,
 *          refresh rotation, password-change invalidation (auth perimeter, previously 0 tests).
 * Caller: backend test gate; part of the auth front-door coverage backfill.
 * Deps: vitest, better-sqlite3 (in-memory), mocked connectionPool + securityAuditLogger; fake fastify.jwt.
 * SideEffects: In-memory database only — never touches prod data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));
vi.mock('../services/securityAuditLogger.js', () => ({
    logSessionInvalidated: vi.fn(),
    logTokenBlacklisted: vi.fn(),
}));

import {
    generateFingerprint,
    validateFingerprint,
    isSessionExpired,
    hashToken,
    createTokenPair,
    blacklistToken,
    isTokenBlacklisted,
    blacklistAllUserTokens,
    isTokenInvalidatedByUser,
    cleanupExpiredBlacklistEntries,
    rotateTokens,
    getSessionConfig,
} from '../services/sessionManager.js';

const USER = { id: 7, username: 'alice', role: 'admin' };
const makeFastify = () => {
    const signed = [];
    return {
        signed,
        jwt: { sign: (payload, opts) => { signed.push({ payload, opts }); return `tok.${payload.type}.${payload.id}.${signed.length}`; } },
    };
};

beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS token_blacklist');
    db.exec('DROP TABLE IF EXISTS users');
    db.exec(`CREATE TABLE token_blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER,
        reason TEXT,
        expires_at TEXT NOT NULL
    )`);
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, tokens_invalidated_at TEXT)');
    db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(USER.id, USER.username);
});

describe('sessionManager — fingerprint & session age', () => {
    it('fingerprint is stable per ip+ua and changes when either changes', () => {
        const req = { ip: '1.2.3.4', headers: { 'user-agent': 'UA' } };
        const a = generateFingerprint(req);
        expect(a).toMatch(/^[a-f0-9]{64}$/);
        expect(generateFingerprint(req)).toBe(a);
        expect(generateFingerprint({ ip: '9.9.9.9', headers: { 'user-agent': 'UA' } })).not.toBe(a);
    });

    it('validateFingerprint matches only on equal fingerprints', () => {
        expect(validateFingerprint({ fingerprint: 'abc' }, 'abc')).toBe(true);
        expect(validateFingerprint({ fingerprint: 'abc' }, 'xyz')).toBe(false);
        expect(validateFingerprint({}, 'abc')).toBe(false);
    });

    it('isSessionExpired honours the 24h absolute timeout', () => {
        expect(isSessionExpired({})).toBe(true); // no sessionCreatedAt
        expect(isSessionExpired({ sessionCreatedAt: Date.now() })).toBe(false);
        expect(isSessionExpired({ sessionCreatedAt: Date.now() - 25 * 60 * 60 * 1000 })).toBe(true);
    });
});

describe('sessionManager — token pair', () => {
    it('creates an access+refresh pair with the right claims', () => {
        const f = makeFastify();
        const pair = createTokenPair(f, USER, 'fp');
        expect(pair.accessToken).toBeTruthy();
        expect(pair.refreshToken).toBeTruthy();
        const access = f.signed[0].payload;
        const refresh = f.signed[1].payload;
        expect(access).toMatchObject({ id: 7, role: 'admin', type: 'access', fingerprint: 'fp' });
        expect(refresh).toMatchObject({ id: 7, type: 'refresh', fingerprint: 'fp' });
        expect(access.sessionCreatedAt).toBe(refresh.sessionCreatedAt);
    });

    it('hashToken is deterministic SHA-256', () => {
        expect(hashToken('jwt.abc')).toBe(hashToken('jwt.abc'));
        expect(hashToken('jwt.abc')).toMatch(/^[a-f0-9]{64}$/);
    });
});

describe('sessionManager — blacklist & invalidation', () => {
    it('blacklisted tokens read back as blacklisted; unknown ones do not', () => {
        expect(isTokenBlacklisted('still-valid')).toBe(false);
        expect(blacklistToken('bad-token', USER.id, 'logout')).toBe(true);
        expect(isTokenBlacklisted('bad-token')).toBe(true);
    });

    it('an expired blacklist entry no longer blocks the token', () => {
        db.prepare('INSERT INTO token_blacklist (token_hash, user_id, reason, expires_at) VALUES (?, ?, ?, ?)')
            .run(hashToken('old'), USER.id, 'logout', new Date(Date.now() - 86400000).toISOString());
        expect(isTokenBlacklisted('old')).toBe(false);
    });

    it('cleanupExpiredBlacklistEntries removes only past-expiry rows', () => {
        blacklistToken('future', USER.id, 'logout'); // default +7d
        db.prepare('INSERT INTO token_blacklist (token_hash, user_id, reason, expires_at) VALUES (?, ?, ?, ?)')
            .run(hashToken('past'), USER.id, 'logout', new Date(Date.now() - 86400000).toISOString());
        expect(cleanupExpiredBlacklistEntries()).toBe(1);
    });

    it('blacklistAllUserTokens stamps users.tokens_invalidated_at', () => {
        expect(blacklistAllUserTokens(USER.id, 'password_change')).toBe(true);
        const row = db.prepare('SELECT tokens_invalidated_at FROM users WHERE id = ?').get(USER.id);
        expect(row.tokens_invalidated_at).toBeTruthy();
    });

    it('isTokenInvalidatedByUser flags tokens issued before the invalidation stamp', () => {
        expect(isTokenInvalidatedByUser({ sessionCreatedAt: Date.now() }, USER.id)).toBe(false); // none yet
        blacklistAllUserTokens(USER.id, 'password_change');
        expect(isTokenInvalidatedByUser({ sessionCreatedAt: Date.now() - 60000 }, USER.id)).toBe(true);  // before
        expect(isTokenInvalidatedByUser({ sessionCreatedAt: Date.now() + 60000 }, USER.id)).toBe(false); // after
    });
});

describe('sessionManager — rotation & config', () => {
    it('rotateTokens blacklists both old tokens and issues a fresh pair', () => {
        const f = makeFastify();
        const pair = rotateTokens(f, 'old-access', 'old-refresh', USER, 'fp');
        expect(isTokenBlacklisted('old-access')).toBe(true);
        expect(isTokenBlacklisted('old-refresh')).toBe(true);
        expect(pair.accessToken).toBeTruthy();
        expect(pair.refreshToken).toBeTruthy();
    });

    it('getSessionConfig exposes a copy of the config', () => {
        const cfg = getSessionConfig();
        expect(cfg.accessTokenExpiry).toBe('1h');
        expect(cfg.refreshTokenExpiry).toBe('7d');
    });
});
