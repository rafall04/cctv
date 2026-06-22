/**
 * Purpose: Lock down the brute-force/account-lockout behaviour (auth perimeter, previously 0 tests).
 * Caller: backend test gate; part of the auth front-door coverage backfill.
 * Deps: vitest, better-sqlite3 (in-memory), mocked database.js + securityAuditLogger.
 * SideEffects: In-memory database only — never touches prod data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

vi.mock('../database/database.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));

const logAccountLockout = vi.fn();
vi.mock('../services/securityAuditLogger.js', () => ({
    logAccountLockout: (...a) => logAccountLockout(...a),
    logAuthAttempt: vi.fn(),
}));

import {
    BRUTE_FORCE_CONFIG,
    trackFailedAttempt,
    trackSuccessfulLogin,
    getFailedAttemptCount,
    clearFailedAttempts,
    cleanupOldAttempts,
    checkLockout,
    getUnlockTime,
    checkAndTriggerLockout,
    getRemainingAttempts,
    getProgressiveDelay,
} from '../services/bruteForceProtection.js';

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
const seedFailure = (identifier, type, when) =>
    db.prepare('INSERT INTO login_attempts (identifier, identifier_type, attempt_time, success) VALUES (?, ?, ?, 0)')
        .run(identifier, type, when);

beforeEach(() => {
    logAccountLockout.mockClear();
    db.exec('DROP TABLE IF EXISTS login_attempts');
    db.exec(`CREATE TABLE login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL,
        identifier_type TEXT NOT NULL,
        attempt_time TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 0
    )`);
});

describe('bruteForceProtection — tracking & counts', () => {
    it('records a failed attempt for both username and ip', () => {
        const { usernameAttempts, ipAttempts } = trackFailedAttempt('alice', '1.2.3.4');
        expect(usernameAttempts).toBe(1);
        expect(ipAttempts).toBe(1);
        expect(getFailedAttemptCount('alice', 'username')).toBe(1);
        expect(getFailedAttemptCount('1.2.3.4', 'ip')).toBe(1);
    });

    it('only counts failures inside the tracking window', () => {
        seedFailure('alice', 'username', minutesAgo(20)); // outside 15-min window
        seedFailure('alice', 'username', minutesAgo(1));  // inside
        expect(getFailedAttemptCount('alice', 'username')).toBe(1);
    });

    it('a successful login clears the username failure counter', () => {
        for (let i = 0; i < 4; i++) trackFailedAttempt('alice', '1.2.3.4');
        expect(getFailedAttemptCount('alice', 'username')).toBe(4);
        trackSuccessfulLogin('alice', '1.2.3.4');
        expect(getFailedAttemptCount('alice', 'username')).toBe(0);
    });

    it('clearFailedAttempts removes only the targeted identifier', () => {
        trackFailedAttempt('alice', '1.2.3.4');
        trackFailedAttempt('bob', '1.2.3.4');
        clearFailedAttempts('alice', 'username');
        expect(getFailedAttemptCount('alice', 'username')).toBe(0);
        expect(getFailedAttemptCount('bob', 'username')).toBe(1);
    });
});

describe('bruteForceProtection — lockout', () => {
    it('does not lock below the username threshold', () => {
        for (let i = 0; i < BRUTE_FORCE_CONFIG.maxAttempts.username - 1; i++) trackFailedAttempt('alice', null);
        expect(checkLockout('alice', null).locked).toBe(false);
    });

    it('locks the username at the threshold (5 failures)', () => {
        for (let i = 0; i < BRUTE_FORCE_CONFIG.maxAttempts.username; i++) trackFailedAttempt('alice', null);
        const r = checkLockout('alice', null);
        expect(r.locked).toBe(true);
        expect(r.lockType).toBe('username');
        expect(r.unlockAt).toBeInstanceOf(Date);
    });

    it('locks the ip at its higher threshold (10 failures)', () => {
        for (let i = 0; i < BRUTE_FORCE_CONFIG.maxAttempts.ip; i++) trackFailedAttempt(null, '9.9.9.9');
        const r = checkLockout(null, '9.9.9.9');
        expect(r.locked).toBe(true);
        expect(r.lockType).toBe('ip');
    });

    it('is not locked once the failures age out of the window', () => {
        for (let i = 0; i < 6; i++) seedFailure('alice', 'username', minutesAgo(20));
        expect(checkLockout('alice', null).locked).toBe(false);
    });

    it('checkAndTriggerLockout flags + audit-logs at threshold', () => {
        for (let i = 0; i < BRUTE_FORCE_CONFIG.maxAttempts.username; i++) trackFailedAttempt('alice', null);
        const r = checkAndTriggerLockout('alice', null, null);
        expect(r.usernameLocked).toBe(true);
        expect(logAccountLockout).toHaveBeenCalledTimes(1);
    });

    it('getRemainingAttempts decrements toward zero', () => {
        trackFailedAttempt('alice', null);
        trackFailedAttempt('alice', null);
        expect(getRemainingAttempts('alice', null).usernameRemaining)
            .toBe(BRUTE_FORCE_CONFIG.maxAttempts.username - 2);
    });

    it('getUnlockTime is null with no attempts and last+duration otherwise', () => {
        expect(getUnlockTime('ghost', 'username')).toBeNull();
        const when = minutesAgo(1);
        seedFailure('alice', 'username', when);
        const expected = new Date(new Date(when).getTime() + BRUTE_FORCE_CONFIG.lockoutDuration.username);
        expect(getUnlockTime('alice', 'username').getTime()).toBe(expected.getTime());
    });
});

describe('bruteForceProtection — progressive delay & cleanup', () => {
    it('progressive delay follows the configured ladder and caps', () => {
        expect(getProgressiveDelay(0)).toBe(0);
        expect(getProgressiveDelay(1)).toBe(BRUTE_FORCE_CONFIG.progressiveDelay[0]);
        expect(getProgressiveDelay(4)).toBe(BRUTE_FORCE_CONFIG.progressiveDelay[3]);
        expect(getProgressiveDelay(99)).toBe(BRUTE_FORCE_CONFIG.progressiveDelay.at(-1));
    });

    it('cleanupOldAttempts removes only rows older than 2x the window', () => {
        seedFailure('alice', 'username', minutesAgo(60)); // older than 2x15min => deleted
        seedFailure('alice', 'username', minutesAgo(1));  // kept
        const deleted = cleanupOldAttempts();
        expect(deleted).toBe(1);
    });
});
