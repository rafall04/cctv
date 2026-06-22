/**
 * Purpose: Lock down the login / refresh / logout front door — credential check, lockout gate,
 *          approval gate (pending/rejected), token rotation, fingerprint binding (previously 0 tests).
 * Caller: backend test gate; the core of the auth front-door coverage backfill.
 * Deps: vitest, better-sqlite3 (in-memory), REAL bruteForceProtection+sessionManager+bcrypt,
 *       mocked connectionPool/database.js (same in-memory db) + audit logger + passwordExpiry; fake server.jwt.
 * SideEffects: In-memory database only — never touches prod data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

// NOTE: vi.mock is hoisted above imports/consts — the factory may only reference `db` (from vi.hoisted),
// not an outer const, so the db-routing object is inlined in each factory.
vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (cb) => db.transaction(cb),
}));
vi.mock('../database/database.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (cb) => db.transaction(cb),
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAuthAttempt: vi.fn(), logSessionCreated: vi.fn(), logSessionRefreshed: vi.fn(),
    logFingerprintMismatch: vi.fn(), logAccountLockout: vi.fn(), logTokenBlacklisted: vi.fn(),
    logSessionInvalidated: vi.fn(),
}));
vi.mock('../services/passwordExpiry.js', () => ({
    checkPasswordExpiry: () => ({ expired: false }),
    checkPasswordExpiryWarning: () => null,
}));
// Keep the real brute-force logic but skip the real setTimeout-based delay so tests stay fast.
vi.mock('../services/bruteForceProtection.js', async (importActual) => {
    const actual = await importActual();
    return { ...actual, applyProgressiveDelay: () => Promise.resolve() };
});

import authService from '../services/authService.js';

const PASSWORD = 'correct-horse-battery';
const PASSWORD_HASH = await bcrypt.hash(PASSWORD, 8);

const makeServer = () => ({
    jwt: {
        sign: (payload) => `signed.${payload.type}.${payload.id}`,
        verify: vi.fn(),
    },
});
const makeRequest = (over = {}) => ({
    ip: '1.2.3.4',
    headers: { 'user-agent': 'UA/1.0' },
    cookies: { token: 'old-access' },
    ...over,
});
const seedUser = (over = {}) => {
    const u = { id: 1, username: 'alice', role: 'admin', account_status: 'approved', ...over };
    db.prepare('INSERT INTO users (id, username, password_hash, role, account_status) VALUES (?, ?, ?, ?, ?)')
        .run(u.id, u.username, u.password_hash || PASSWORD_HASH, u.role, u.account_status);
    return u;
};

beforeEach(() => {
    for (const t of ['users', 'audit_logs', 'login_attempts', 'token_blacklist']) db.exec(`DROP TABLE IF EXISTS ${t}`);
    db.exec(`CREATE TABLE users (
        id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, role TEXT,
        account_status TEXT DEFAULT 'approved', last_login_at TEXT, last_login_ip TEXT, tokens_invalidated_at TEXT
    )`);
    db.exec(`CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, details TEXT, ip_address TEXT)`);
    db.exec(`CREATE TABLE login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, identifier TEXT, identifier_type TEXT, attempt_time TEXT, success INTEGER DEFAULT 0)`);
    db.exec(`CREATE TABLE token_blacklist (id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT UNIQUE, user_id INTEGER, reason TEXT, expires_at TEXT)`);
});

describe('authService.login', () => {
    it('issues tokens + audit log on correct credentials for an approved user', async () => {
        seedUser();
        const res = await authService.login('alice', PASSWORD, '1.2.3.4', makeRequest(), makeServer());
        expect(res.accessToken).toBeTruthy();
        expect(res.refreshToken).toBeTruthy();
        expect(res.user).toMatchObject({ id: 1, username: 'alice', role: 'admin' });
        const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'LOGIN'").get();
        expect(audit).toBeTruthy();
    });

    it('rejects a wrong password with 401 and records a failed attempt', async () => {
        seedUser();
        await expect(authService.login('alice', 'wrong', '1.2.3.4', makeRequest(), makeServer()))
            .rejects.toMatchObject({ statusCode: 401 });
        expect(db.prepare("SELECT COUNT(*) c FROM login_attempts WHERE success = 0").get().c).toBeGreaterThan(0);
    });

    it('rejects an unknown user with 401 (no user enumeration)', async () => {
        await expect(authService.login('ghost', PASSWORD, '1.2.3.4', makeRequest(), makeServer()))
            .rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
    });

    it('locks the account after 5 failed attempts (6th try blocked pre-password)', async () => {
        seedUser();
        for (let i = 0; i < 5; i++) {
            await authService.login('alice', 'wrong', '1.2.3.4', makeRequest(), makeServer()).catch(() => {});
        }
        // Even the CORRECT password is now refused because the lockout gate runs first.
        await expect(authService.login('alice', PASSWORD, '1.2.3.4', makeRequest(), makeServer()))
            .rejects.toMatchObject({ statusCode: 401 });
    });

    it('blocks a pending account with 403 pending_approval (after password check)', async () => {
        seedUser({ account_status: 'pending' });
        await expect(authService.login('alice', PASSWORD, '1.2.3.4', makeRequest(), makeServer()))
            .rejects.toMatchObject({ statusCode: 403, reason: 'pending_approval' });
    });

    it('blocks a rejected account with 403 registration_rejected', async () => {
        seedUser({ account_status: 'rejected' });
        await expect(authService.login('alice', PASSWORD, '1.2.3.4', makeRequest(), makeServer()))
            .rejects.toMatchObject({ statusCode: 403, reason: 'registration_rejected' });
    });
});

describe('authService.refreshTokens', () => {
    const decodedRefresh = (over = {}) => ({ id: 1, username: 'alice', type: 'refresh', fingerprint: null, sessionCreatedAt: Date.now(), ...over });

    it('rotates to a new token pair on a valid refresh token', async () => {
        seedUser();
        const req = makeRequest();
        const server = makeServer();
        // fingerprint must match what generateFingerprint(req) produces
        const { generateFingerprint } = await import('../services/sessionManager.js');
        server.jwt.verify.mockReturnValue(decodedRefresh({ fingerprint: generateFingerprint(req) }));
        const res = await authService.refreshTokens('good-refresh', server, req);
        expect(res.newAccessToken).toBeTruthy();
        expect(res.newRefreshToken).toBeTruthy();
    });

    it('rejects a blacklisted refresh token with 401', async () => {
        seedUser();
        const { blacklistToken } = await import('../services/sessionManager.js');
        blacklistToken('revoked-refresh', 1, 'logout');
        await expect(authService.refreshTokens('revoked-refresh', makeServer(), makeRequest()))
            .rejects.toMatchObject({ statusCode: 401 });
    });

    it('rejects an unverifiable token with 401', async () => {
        const server = makeServer();
        server.jwt.verify.mockImplementation(() => { throw new Error('bad sig'); });
        await expect(authService.refreshTokens('garbage', server, makeRequest()))
            .rejects.toMatchObject({ statusCode: 401 });
    });

    it('rejects a non-refresh token type with 401', async () => {
        const server = makeServer();
        server.jwt.verify.mockReturnValue(decodedRefresh({ type: 'access' }));
        await expect(authService.refreshTokens('an-access-token', server, makeRequest()))
            .rejects.toMatchObject({ statusCode: 401 });
    });

    it('rejects + blacklists on fingerprint mismatch', async () => {
        seedUser();
        const server = makeServer();
        server.jwt.verify.mockReturnValue(decodedRefresh({ fingerprint: 'a-different-device' }));
        await expect(authService.refreshTokens('stolen-refresh', server, makeRequest()))
            .rejects.toMatchObject({ statusCode: 401 });
        const { isTokenBlacklisted } = await import('../services/sessionManager.js');
        expect(isTokenBlacklisted('stolen-refresh')).toBe(true);
    });
});

describe('authService.logout', () => {
    it('blacklists both tokens and writes a LOGOUT audit log', async () => {
        seedUser();
        await authService.logout(1, '1.2.3.4', 'acc-token', 'ref-token');
        const { isTokenBlacklisted } = await import('../services/sessionManager.js');
        expect(isTokenBlacklisted('acc-token')).toBe(true);
        expect(isTokenBlacklisted('ref-token')).toBe(true);
        expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'LOGOUT'").get().c).toBe(1);
    });
});
