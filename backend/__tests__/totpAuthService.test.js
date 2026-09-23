/**
 * Purpose: Lock down the 2FA orchestration — enrollment state machine, pending-token
 *          challenge, per-user challenge lockout, one-time recovery codes, and the
 *          never-leak-secret invariant.
 * Caller: backend test gate for F2.1.
 * Deps: vitest, better-sqlite3 (in-memory) via mocked connectionPool; REAL totpService
 *       crypto; mocked securityAuditLogger.
 * SideEffects: In-memory database only.
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
    transaction: (cb) => db.transaction(cb),
}));
vi.mock('../services/securityAuditLogger.js', () => ({
    logAuthAttempt: vi.fn(),
    logSecurityEvent: vi.fn(),
}));
// Per-test toggle for the mandatory-admin-2FA flag — the getter reads it at call time.
const { totpFlags } = await vi.hoisted(() => ({ totpFlags: { adminTotpRequired: false } }));
vi.mock('../config/config.js', async (importActual) => {
    const actual = await importActual();
    const config = {
        ...actual.config,
        security: {
            ...actual.config.security,
            get adminTotpRequired() { return totpFlags.adminTotpRequired; },
        },
    };
    return { ...actual, config, default: config };
});

import { logSecurityEvent } from '../services/securityAuditLogger.js';
import totpAuthService from '../services/totpAuthService.js';
import totpService from '../services/totpService.js';

// A server double whose jwt is honest base64 JSON — exercises the real claim checks
// (type/fp/sub) in verifyChallenge without shipping a real signing key into tests.
const makeServer = () => ({
    jwt: {
        sign: (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url'),
        verify: (token) => JSON.parse(Buffer.from(token, 'base64url').toString()),
    },
});
const REQUEST = { ip: '10.0.0.9' };
const FP = 'fp-test-device';

const seedUser = (over = {}) => {
    db.prepare('INSERT INTO users (id, username, role, totp_enabled) VALUES (?, ?, ?, ?)')
        .run(over.id ?? 1, over.username ?? 'alice', over.role ?? 'admin', over.totp_enabled ?? 0);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(over.id ?? 1);
};

const row = (id = 1) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

beforeEach(() => {
    totpFlags.adminTotpRequired = false;
    for (const t of ['users', 'audit_logs']) db.exec(`DROP TABLE IF EXISTS ${t}`);
    db.exec(`CREATE TABLE users (
        id INTEGER PRIMARY KEY, username TEXT, role TEXT, account_status TEXT DEFAULT 'approved',
        totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_confirmed_at TEXT,
        totp_recovery_hashes TEXT, totp_failed_attempts INTEGER NOT NULL DEFAULT 0,
        totp_locked_until TEXT
    )`);
    db.exec(`CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, details TEXT, ip_address TEXT)`);
});

describe('enrollment: start → confirm → enabled', () => {
    it('startSetup stores an ENCRYPTED seed and keeps 2FA disabled until confirmed', async () => {
        seedUser();
        const data = await totpAuthService.startSetup(1, 'alice', REQUEST);
        expect(data.secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(data.otpauthUrl).toContain(`secret=${data.secret}`);
        expect(data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
        const stored = row().totp_secret;
        expect(stored).not.toBe(data.secret);                 // sealed at rest
        expect(totpService.decryptSecret(stored)).toBe(data.secret);
        expect(row().totp_enabled).toBe(0);                   // pending — cannot lock anyone out
    });

    it('confirmSetup with a live code enables 2FA and mints 8 hashed recovery codes', async () => {
        seedUser();
        const { secret } = await totpAuthService.startSetup(1, 'alice', REQUEST);
        const code = totpService.totp(secret);
        const { recoveryCodes } = totpAuthService.confirmSetup(1, code, REQUEST);
        expect(recoveryCodes).toHaveLength(8);
        const u = row();
        expect(u.totp_enabled).toBe(1);
        expect(u.totp_confirmed_at).toBeTruthy();
        const hashes = JSON.parse(u.totp_recovery_hashes);
        expect(hashes).toHaveLength(8);
        // Stored are digests — the plaintext code must not appear in the row.
        expect(u.totp_recovery_hashes).not.toContain(recoveryCodes[0]);
        expect(hashes).toContain(totpService.hashRecoveryCode(recoveryCodes[0]));
    });

    it('startSetup refuses to overwrite an ACTIVE enrollment — disable first', async () => {
        seedUser();
        const { secret } = await totpAuthService.startSetup(1, 'alice', REQUEST);
        totpAuthService.confirmSetup(1, totpService.totp(secret), REQUEST);
        await expect(totpAuthService.startSetup(1, 'alice', REQUEST))
            .rejects.toThrowError(expect.objectContaining({ statusCode: 400 }));
        // The live seed is untouched — the existing authenticator still works.
        expect(totpService.decryptSecret(row().totp_secret)).toBe(secret);
    });

    it('confirmSetup with a wrong code stays disabled and audits the failure', async () => {
        seedUser();
        await totpAuthService.startSetup(1, 'alice', REQUEST);
        expect(() => totpAuthService.confirmSetup(1, '000000', REQUEST))
            .toThrowError(expect.objectContaining({ statusCode: 400 }));
        expect(row().totp_enabled).toBe(0);
        expect(logSecurityEvent).toHaveBeenCalledWith('TOTP_VERIFY_FAILED', expect.anything(), REQUEST);
    });
});

describe('login challenge (verifyChallenge)', () => {
    /** Enroll the user and return { secret, recoveryCodes }. */
    const enroll = async () => {
        seedUser();
        const { secret } = await totpAuthService.startSetup(1, 'alice', REQUEST);
        const code = totpService.totp(secret);
        const { recoveryCodes } = totpAuthService.confirmSetup(1, code, REQUEST);
        return { secret, recoveryCodes };
    };
    const pending = (server, over = {}) => totpAuthService.createPendingToken(
        server, { id: 1, username: 'alice' }, FP
    );

    it('accepts a live TOTP and clears any failure counter', async () => {
        const { secret } = await enroll();
        const server = makeServer();
        const res = totpAuthService.verifyChallenge(server, {
            pendingToken: pending(server), code: totpService.totp(secret), fingerprint: FP, request: REQUEST,
        });
        expect(res.user.id).toBe(1);
        expect(res.usedRecovery).toBe(false);
        expect(row().totp_failed_attempts).toBe(0);
    });

    it('rejects a wrong code with 401 and increments the failure counter', async () => {
        await enroll();
        const server = makeServer();
        expect(() => totpAuthService.verifyChallenge(server, {
            pendingToken: pending(server), code: '000000', fingerprint: FP, request: REQUEST,
        })).toThrowError(expect.objectContaining({ statusCode: 401 }));
        expect(row().totp_failed_attempts).toBe(1);
    });

    it('locks the challenge after 5 bad codes — even a CORRECT code is refused while locked', async () => {
        const { secret } = await enroll();
        const server = makeServer();
        const token = pending(server);
        for (let i = 0; i < 5; i++) {
            expect(() => totpAuthService.verifyChallenge(server, {
                pendingToken: token, code: '000000', fingerprint: FP, request: REQUEST,
            })).toThrowError(expect.objectContaining({ statusCode: 401 }));
        }
        expect(row().totp_locked_until).toBeTruthy();
        expect(() => totpAuthService.verifyChallenge(server, {
            pendingToken: token, code: totpService.totp(secret), fingerprint: FP, request: REQUEST,
        })).toThrowError(expect.objectContaining({ statusCode: 401 }));
    });

    it('a recovery code verifies ONCE, then is consumed', async () => {
        const { recoveryCodes } = await enroll();
        const server = makeServer();
        const res = totpAuthService.verifyChallenge(server, {
            pendingToken: pending(server), code: recoveryCodes[0], fingerprint: FP, request: REQUEST,
        });
        expect(res.usedRecovery).toBe(true);
        expect(JSON.parse(row().totp_recovery_hashes)).toHaveLength(7);
        // Replay of the same recovery code must fail.
        expect(() => totpAuthService.verifyChallenge(server, {
            pendingToken: pending(server), code: recoveryCodes[0], fingerprint: FP, request: REQUEST,
        })).toThrowError(expect.objectContaining({ statusCode: 401 }));
    });

    it('rejects an expired/malformed pending token and one bound to another device', async () => {
        const { secret } = await enroll();
        const server = makeServer();
        expect(() => totpAuthService.verifyChallenge(server, {
            pendingToken: 'not-a-jwt', code: totpService.totp(secret), fingerprint: FP, request: REQUEST,
        })).toThrowError(expect.objectContaining({ statusCode: 401, message: expect.stringContaining('kedaluwarsa') }));
        expect(() => totpAuthService.verifyChallenge(server, {
            pendingToken: pending(server), code: totpService.totp(secret), fingerprint: 'fp-OTHER-device', request: REQUEST,
        })).toThrowError(expect.objectContaining({ statusCode: 401 }));
    });

    it('rejects a pending token when 2FA was meanwhile disabled', async () => {
        const { secret } = await enroll();
        const server = makeServer();
        const token = pending(server);
        db.prepare('UPDATE users SET totp_enabled = 0 WHERE id = 1').run();
        expect(() => totpAuthService.verifyChallenge(server, {
            pendingToken: token, code: totpService.totp(secret), fingerprint: FP, request: REQUEST,
        })).toThrowError(expect.objectContaining({ statusCode: 401 }));
    });
});

describe('disable + status', () => {
    it('disable requires a live code and wipes ALL totp material', async () => {
        seedUser({ totp_enabled: 0 });
        await totpAuthService.startSetup(1, 'alice', REQUEST);
        // Not enabled yet → disable refuses (there is nothing to turn off).
        expect(() => totpAuthService.disable(1, '123456', REQUEST))
            .toThrowError(expect.objectContaining({ statusCode: 400 }));
    });

    it('full lifecycle: enable → status honest → disable with code → status clean', async () => {
        seedUser();
        const { secret } = await totpAuthService.startSetup(1, 'alice', REQUEST);
        totpAuthService.confirmSetup(1, totpService.totp(secret), REQUEST);

        const on = totpAuthService.getStatus(1);
        expect(on).toMatchObject({ enabled: true, recoveryRemaining: 8 });
        expect(JSON.stringify(on)).not.toContain(secret);     // status never leaks the seed

        // Wrong code on an AUTHENTICATED request is a validation failure (400), not
        // a 401 — the session is valid; a 401 would trigger the frontend's
        // refresh→retry→session-expired path and kick a healthy admin out for a typo.
        expect(() => totpAuthService.disable(1, '000000', REQUEST))
            .toThrowError(expect.objectContaining({ statusCode: 400 }));
        totpAuthService.disable(1, totpService.totp(secret), REQUEST);
        const u = row();
        expect(u.totp_enabled).toBe(0);
        expect(u.totp_secret).toBeNull();
        expect(u.totp_recovery_hashes).toBeNull();
        expect(totpAuthService.getStatus(1).enabled).toBe(false);
    });

    it('an admin cannot disable 2FA while enrollment is mandatory — that would reopen the gate', async () => {
        totpFlags.adminTotpRequired = true;
        seedUser();
        const { secret } = await totpAuthService.startSetup(1, 'alice', REQUEST);
        totpAuthService.confirmSetup(1, totpService.totp(secret), REQUEST);
        expect(() => totpAuthService.disable(1, totpService.totp(secret), REQUEST))
            .toThrowError(expect.objectContaining({ statusCode: 400, message: expect.stringContaining('wajib') }));
        expect(row().totp_enabled).toBe(1);   // still armed
    });

    it('a non-admin CAN still disable their own 2FA under the same flag', async () => {
        totpFlags.adminTotpRequired = true;
        seedUser({ role: 'viewer' });
        const { secret } = await totpAuthService.startSetup(1, 'alice', REQUEST);
        totpAuthService.confirmSetup(1, totpService.totp(secret), REQUEST);
        totpAuthService.disable(1, totpService.totp(secret), REQUEST);
        expect(row().totp_enabled).toBe(0);
    });

    it('verifyEnrollToken accepts only its own token type + bound fingerprint', async () => {
        const server = makeServer();
        seedUser();
        const enrollToken = totpAuthService.createEnrollToken(server, { id: 1, username: 'alice' }, FP);
        const res = totpAuthService.verifyEnrollToken(server, { enrollToken, fingerprint: FP });
        expect(res.user.id).toBe(1);
        // A challenge token does not unlock the enroll path.
        const pendingToken = totpAuthService.createPendingToken(server, { id: 1, username: 'alice' }, FP);
        expect(() => totpAuthService.verifyEnrollToken(server, { enrollToken: pendingToken, fingerprint: FP }))
            .toThrowError(expect.objectContaining({ statusCode: 401 }));
        // Nor does a foreign fingerprint or a dead token.
        expect(() => totpAuthService.verifyEnrollToken(server, { enrollToken, fingerprint: 'fp-other' }))
            .toThrowError(expect.objectContaining({ statusCode: 401 }));
        expect(() => totpAuthService.verifyEnrollToken(server, { enrollToken: 'junk', fingerprint: FP }))
            .toThrowError(expect.objectContaining({ statusCode: 401 }));
    });
});
