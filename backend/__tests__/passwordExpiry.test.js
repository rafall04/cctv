/**
 * Purpose: Cover the 90-day password-expiry rules — the last untested member of the auth perimeter.
 * Caller: Vitest backend suite.
 * Deps: better-sqlite3 (in-memory) behind a mocked connectionPool.
 * MainFuncs: checkPasswordExpiry, checkPasswordExpiryWarning, updatePasswordChangedAt,
 *            getPasswordAgeDays, getUsersWithExpiredPasswords, getUsersWithPasswordsExpiringSoon.
 * SideEffects: None; every row lives in an in-memory database.
 *
 * The auth perimeter has a test-count floor precisely so this kind of gap cannot reopen, yet
 * this module sat at 0% while being part of it. Writing the tests immediately turned up a
 * latent defect in the two "list the affected users" functions — see the regression below.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: SQLite } = await import('better-sqlite3');
    return { db: new SQLite(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));

const svc = await import('../services/passwordExpiry.js');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d) => new Date(Date.now() - d * DAY).toISOString();

function addUser(id, username, changedAt) {
    db.prepare('INSERT INTO users (id, username, password_changed_at) VALUES (?,?,?)').run(id, username, changedAt);
}

beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS users');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_changed_at TEXT)');
    vi.restoreAllMocks();
});

describe('checkPasswordExpiry', () => {
    it('reports a fresh password as not expired, with days remaining', () => {
        addUser(1, 'admin', daysAgo(10));
        const r = svc.checkPasswordExpiry(1);
        expect(r.expired).toBe(false);
        expect(r.daysRemaining).toBe(80);
        expect(r.expiresAt).toBeInstanceOf(Date);
    });

    it('reports a password past the 90-day limit as expired', () => {
        addUser(1, 'admin', daysAgo(91));
        const r = svc.checkPasswordExpiry(1);
        expect(r.expired).toBe(true);
        expect(r.daysRemaining).toBe(0);
    });

    it('never reports negative days remaining', () => {
        addUser(1, 'admin', daysAgo(400));
        expect(svc.checkPasswordExpiry(1).daysRemaining).toBe(0);
    });

    /*
     * Accounts that predate the policy have no timestamp. They must be treated as "unknown",
     * not "expired" — locking every legacy admin out of their own system on deploy day is a
     * worse outcome than a stale password.
     */
    it('treats a user with no recorded change date as not expired', () => {
        addUser(1, 'legacy', null);
        expect(svc.checkPasswordExpiry(1)).toEqual({ expired: false, daysRemaining: null, expiresAt: null });
    });

    it('treats an unknown user as not expired rather than throwing', () => {
        expect(svc.checkPasswordExpiry(999)).toEqual({ expired: false, daysRemaining: null, expiresAt: null });
    });

    it('degrades to not-expired if the query blows up', () => {
        db.exec('DROP TABLE users');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(svc.checkPasswordExpiry(1).expired).toBe(false);
    });
});

describe('checkPasswordExpiryWarning', () => {
    it('warns immediately once expired', () => {
        addUser(1, 'admin', daysAgo(95));
        const r = svc.checkPasswordExpiryWarning(1);
        expect(r.shouldWarn).toBe(true);
        expect(r.daysRemaining).toBe(0);
        expect(r.message).toMatch(/expired/i);
    });

    it('warns inside the 14-day window', () => {
        addUser(1, 'admin', daysAgo(80));
        const r = svc.checkPasswordExpiryWarning(1);
        expect(r.shouldWarn).toBe(true);
        expect(r.daysRemaining).toBe(10);
        expect(r.message).toContain('10 days');
    });

    it('says "1 day", not "1 days"', () => {
        addUser(1, 'admin', daysAgo(89));
        expect(svc.checkPasswordExpiryWarning(1).message).toContain('1 day.');
    });

    it('stays quiet outside the warning window', () => {
        addUser(1, 'admin', daysAgo(30));
        const r = svc.checkPasswordExpiryWarning(1);
        expect(r.shouldWarn).toBe(false);
        expect(r.message).toBeNull();
    });

    it('stays quiet for a user with no recorded change date', () => {
        addUser(1, 'legacy', null);
        expect(svc.checkPasswordExpiryWarning(1)).toEqual({ shouldWarn: false, daysRemaining: null, message: null });
    });
});

describe('updatePasswordChangedAt', () => {
    it('stamps the change and clears an existing expiry', () => {
        addUser(1, 'admin', daysAgo(200));
        expect(svc.checkPasswordExpiry(1).expired).toBe(true);

        expect(svc.updatePasswordChangedAt(1)).toBe(true);

        expect(svc.checkPasswordExpiry(1).expired).toBe(false);
        expect(svc.getPasswordAgeDays(1)).toBe(0);
    });

    it('returns false instead of throwing when the write fails', () => {
        db.exec('DROP TABLE users');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(svc.updatePasswordChangedAt(1)).toBe(false);
    });
});

describe('getPasswordAgeDays', () => {
    it('floors the age in days', () => {
        addUser(1, 'admin', daysAgo(45));
        expect(svc.getPasswordAgeDays(1)).toBe(45);
    });

    it('returns null when there is nothing to measure', () => {
        addUser(1, 'legacy', null);
        expect(svc.getPasswordAgeDays(1)).toBeNull();
        expect(svc.getPasswordAgeDays(999)).toBeNull();
    });
});

describe('the "which users are affected" reports', () => {
    /*
     * REGRESSION. Both of these are documented as returning a LIST, and both were built on
     * `queryOne` — a single row, wrapped as `users ? [users] : []`. So they reported ONE
     * overdue account no matter how many existed. Nothing calls them yet, which is the only
     * reason it never surfaced: the first admin screen to use them would have quietly
     * understated the problem it exists to reveal.
     */
    it('lists EVERY user with an expired password, not just the first', () => {
        addUser(1, 'old-a', daysAgo(120));
        addUser(2, 'old-b', daysAgo(100));
        addUser(3, 'old-c', daysAgo(95));
        addUser(4, 'fresh', daysAgo(5));
        addUser(5, 'legacy', null);

        const expired = svc.getUsersWithExpiredPasswords();

        expect(expired).toHaveLength(3);
        expect(expired.map((u) => u.username).sort()).toEqual(['old-a', 'old-b', 'old-c']);
    });

    it('lists EVERY user inside the warning window, not just the first', () => {
        addUser(1, 'warn-a', daysAgo(80));
        addUser(2, 'warn-b', daysAgo(85));
        addUser(3, 'already-expired', daysAgo(120));
        addUser(4, 'fresh', daysAgo(10));

        const soon = svc.getUsersWithPasswordsExpiringSoon();

        expect(soon).toHaveLength(2);
        expect(soon.map((u) => u.username).sort()).toEqual(['warn-a', 'warn-b']);
    });

    it('honours a custom warning window', () => {
        addUser(1, 'in-5-days', daysAgo(85));
        addUser(2, 'in-20-days', daysAgo(70));

        expect(svc.getUsersWithPasswordsExpiringSoon(7).map((u) => u.username)).toEqual(['in-5-days']);
        expect(svc.getUsersWithPasswordsExpiringSoon(30).map((u) => u.username).sort())
            .toEqual(['in-20-days', 'in-5-days']);
    });

    it('returns an empty list when nobody is affected', () => {
        addUser(1, 'fresh', daysAgo(1));
        expect(svc.getUsersWithExpiredPasswords()).toEqual([]);
        expect(svc.getUsersWithPasswordsExpiringSoon()).toEqual([]);
    });

    it('returns an empty list rather than throwing when the query fails', () => {
        db.exec('DROP TABLE users');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(svc.getUsersWithExpiredPasswords()).toEqual([]);
        expect(svc.getUsersWithPasswordsExpiringSoon()).toEqual([]);
    });
});
