/**
 * Purpose: Cover the security audit trail — the record every other security control is judged by.
 * Caller: Vitest backend suite.
 * Deps: better-sqlite3 (in-memory), services/securityAuditLogger with connectionPool mocked onto it.
 * MainFuncs: logSecurityEvent, logAuthAttempt, generateFingerprint, getSecurityLogsPage, cleanupOldLogs.
 * SideEffects: None; every row lives in an in-memory database.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The auth perimeter got a 47-test backfill in 2026-06 and a test-count floor to stop it
 * being deleted again. securityAuditLogger was the one service in that perimeter left with
 * no tests at all — which is backwards, because it is the thing that records what the other
 * controls did. A lockout nobody can prove happened is not much of a lockout.
 *
 * Against a real SQLite file rather than a mock: the interesting behaviour here is SQL
 * (filtering, pagination, retention cutoffs) and a mock cannot get that wrong or right.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: SQLite } = await import('better-sqlite3');
    return { db: new SQLite(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));

const logger = await import('../services/securityAuditLogger.js');

const daysAgoIso = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
};

beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS security_logs');
    db.exec(`
        CREATE TABLE security_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT,
            user_agent TEXT,
            fingerprint TEXT,
            username TEXT,
            endpoint TEXT,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const fakeRequest = (over = {}) => ({
    ip: '203.0.113.7',
    url: '/api/auth/login',
    headers: { 'user-agent': 'Mozilla/5.0 (probe)' },
    ...over,
});

describe('generateFingerprint', () => {
    it('is stable for the same ip + user agent', () => {
        expect(logger.generateFingerprint(fakeRequest()))
            .toBe(logger.generateFingerprint(fakeRequest()));
    });

    it('changes when the ip changes', () => {
        expect(logger.generateFingerprint(fakeRequest()))
            .not.toBe(logger.generateFingerprint(fakeRequest({ ip: '198.51.100.9' })));
    });

    it('changes when the user agent changes', () => {
        expect(logger.generateFingerprint(fakeRequest()))
            .not.toBe(logger.generateFingerprint(fakeRequest({ headers: { 'user-agent': 'curl/8' } })));
    });

    it('degrades to a constant rather than throwing on a missing request', () => {
        expect(logger.generateFingerprint(null)).toBe('unknown');
        expect(() => logger.generateFingerprint({})).not.toThrow();
    });
});

describe('logSecurityEvent', () => {
    it('persists the event with the request context attached', () => {
        logger.logSecurityEvent(logger.SECURITY_EVENTS.AUTH_FAILURE, { username: 'admin' }, fakeRequest());

        const row = db.prepare('SELECT * FROM security_logs').get();
        expect(row.event_type).toBe(logger.SECURITY_EVENTS.AUTH_FAILURE);
        expect(row.ip_address).toBe('203.0.113.7');
        expect(row.username).toBe('admin');
        expect(row.endpoint).toBe('/api/auth/login');
        expect(row.user_agent).toContain('probe');
        expect(row.fingerprint).toHaveLength(64);
    });

    it('explicit details win over the request', () => {
        logger.logSecurityEvent('TEST', { ip_address: '10.1.1.1', endpoint: '/override' }, fakeRequest());
        const row = db.prepare('SELECT * FROM security_logs').get();
        expect(row.ip_address).toBe('10.1.1.1');
        expect(row.endpoint).toBe('/override');
    });

    it('falls back to x-forwarded-for when request.ip is absent', () => {
        logger.logSecurityEvent('TEST', {}, { headers: { 'x-forwarded-for': '198.51.100.3' } });
        expect(db.prepare('SELECT ip_address FROM security_logs').get().ip_address).toBe('198.51.100.3');
    });

    it('names the authenticated caller when details omit a username', () => {
        // Regression: every generic ADMIN_ACTION landed with username NULL. The endpoint and the
        // payload were there, so the row looked fine — but it never said who did it.
        logger.logAdminAction(
            { action: 'voucher_profile_deleted', profileId: 3 },
            { ...fakeRequest(), url: '/api/admin/voucher/profiles/3', user: { id: 1, username: 'admin' } }
        );

        const row = db.prepare('SELECT * FROM security_logs').get();
        expect(row.event_type).toBe(logger.SECURITY_EVENTS.ADMIN_ACTION);
        expect(row.username).toBe('admin');
        expect(row.endpoint).toBe('/api/admin/voucher/profiles/3');
    });

    it('lets an explicit username outrank the request user', () => {
        logger.logSecurityEvent('TEST', { username: 'ditentukan' }, { ...fakeRequest(), user: { username: 'admin' } });
        expect(db.prepare('SELECT username FROM security_logs').get().username).toBe('ditentukan');
    });

    it('records unknowns instead of failing when there is no request at all', () => {
        expect(() => logger.logSecurityEvent('TEST', {})).not.toThrow();
        const row = db.prepare('SELECT * FROM security_logs').get();
        expect(row.ip_address).toBe('unknown');
        expect(row.fingerprint).toBe('unknown');
    });

    /*
     * The audit trail must never be able to take down the thing it is auditing. If the
     * table is missing (fresh DB, pending migration) the event goes to the console and the
     * caller carries on — a failed login must still be refused even if it cannot be filed.
     */
    it('never throws when the table is missing — it degrades to the console', () => {
        db.exec('DROP TABLE security_logs');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        expect(() => logger.logSecurityEvent('TEST', { username: 'x' }, fakeRequest())).not.toThrow();
        expect(warn).toHaveBeenCalled();
        expect(log.mock.calls[0][1]).toContain('username');
    });

    it('serialises details to JSON so the row keeps the payload', () => {
        logger.logSecurityEvent('TEST', { reason: 'brute_force', attempts: 5 }, fakeRequest());
        const parsed = JSON.parse(db.prepare('SELECT details FROM security_logs').get().details);
        expect(parsed).toMatchObject({ reason: 'brute_force', attempts: 5 });
    });
});

describe('logAuthAttempt', () => {
    it('maps success and failure onto distinct event types', () => {
        logger.logAuthAttempt(true, { username: 'admin' }, fakeRequest());
        logger.logAuthAttempt(false, { username: 'admin' }, fakeRequest());

        const types = db.prepare('SELECT event_type FROM security_logs ORDER BY id').all().map((r) => r.event_type);
        expect(types[0]).toBe(logger.SECURITY_EVENTS.AUTH_SUCCESS);
        expect(types[1]).toBe(logger.SECURITY_EVENTS.AUTH_FAILURE);
        expect(types[0]).not.toBe(types[1]);
    });
});

describe('getSecurityLogsPage', () => {
    beforeEach(() => {
        const insert = db.prepare(`
            INSERT INTO security_logs (event_type, timestamp, ip_address, username, endpoint, details)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (let i = 0; i < 7; i += 1) {
            insert.run('AUTH_FAILURE', daysAgoIso(i), `10.0.0.${i}`, `user${i}`, '/api/auth/login', '{}');
        }
        insert.run('RATE_LIMIT', daysAgoIso(1), '10.0.9.9', 'flooder', '/api/cameras', '{}');
    });

    it('paginates and reports the total', () => {
        const page = logger.getSecurityLogsPage({ page: 1, limit: 3 });
        expect(page.logs).toHaveLength(3);
        expect(page.pagination).toMatchObject({ page: 1, limit: 3, total: 8, totalPages: 3 });
    });

    it('returns the second page without repeating the first', () => {
        const first = logger.getSecurityLogsPage({ page: 1, limit: 3 }).logs.map((l) => l.id);
        const second = logger.getSecurityLogsPage({ page: 2, limit: 3 }).logs.map((l) => l.id);
        expect(second).toHaveLength(3);
        expect(second.some((id) => first.includes(id))).toBe(false);
    });

    it('filters by event type', () => {
        const page = logger.getSecurityLogsPage({ eventType: 'RATE_LIMIT' });
        expect(page.pagination.total).toBe(1);
        expect(page.logs[0].username).toBe('flooder');
    });

    it('searches across ip, username, endpoint and details', () => {
        expect(logger.getSecurityLogsPage({ search: 'flooder' }).pagination.total).toBe(1);
        expect(logger.getSecurityLogsPage({ search: '10.0.9.9' }).pagination.total).toBe(1);
        expect(logger.getSecurityLogsPage({ search: '/api/cameras' }).pagination.total).toBe(1);
    });

    it('combines an event-type filter with a search', () => {
        expect(logger.getSecurityLogsPage({ eventType: 'AUTH_FAILURE', search: 'flooder' }).pagination.total).toBe(0);
    });

    /*
     * A search string is user input reaching a LIKE clause. It is bound, so a quote or a
     * wildcard is matched literally rather than changing the statement.
     */
    it('treats SQL metacharacters in the search as literal text', () => {
        expect(() => logger.getSecurityLogsPage({ search: "'; DROP TABLE security_logs; --" })).not.toThrow();
        expect(logger.getSecurityLogsPage({ search: "'; DROP TABLE security_logs; --" }).pagination.total).toBe(0);
        // The table is still there, and still populated.
        expect(db.prepare('SELECT COUNT(*) c FROM security_logs').get().c).toBe(8);
    });

    it('clamps an absurd limit instead of trusting it', () => {
        expect(logger.getSecurityLogsPage({ limit: 100000 }).pagination.limit).toBe(200);
        expect(logger.getSecurityLogsPage({ limit: 0 }).pagination.limit).toBe(50);
        expect(logger.getSecurityLogsPage({ page: -5 }).pagination.page).toBe(1);
    });

    it('returns an empty page rather than throwing when the table is missing', () => {
        db.exec('DROP TABLE security_logs');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = logger.getSecurityLogsPage({});
        expect(page.logs).toEqual([]);
        expect(page.pagination.total).toBe(0);
    });
});

describe('cleanupOldLogs', () => {
    it('deletes only what is past the retention window', () => {
        const insert = db.prepare('INSERT INTO security_logs (event_type, timestamp) VALUES (?, ?)');
        insert.run('OLD', daysAgoIso(logger.LOG_RETENTION_DAYS + 5));
        insert.run('OLD', daysAgoIso(logger.LOG_RETENTION_DAYS + 1));
        insert.run('EDGE', daysAgoIso(logger.LOG_RETENTION_DAYS - 1));
        insert.run('FRESH', daysAgoIso(0));
        vi.spyOn(console, 'log').mockImplementation(() => {});

        expect(logger.cleanupOldLogs()).toBe(2);

        const kept = db.prepare('SELECT event_type FROM security_logs ORDER BY id').all().map((r) => r.event_type);
        expect(kept).toEqual(['EDGE', 'FRESH']);
    });

    it('is silent and harmless when there is nothing old', () => {
        db.prepare('INSERT INTO security_logs (event_type, timestamp) VALUES (?, ?)').run('FRESH', daysAgoIso(1));
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(logger.cleanupOldLogs()).toBe(0);
        expect(log).not.toHaveBeenCalled();
    });

    it('returns 0 instead of throwing when the table is missing', () => {
        db.exec('DROP TABLE security_logs');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(logger.cleanupOldLogs()).toBe(0);
    });
});

describe('the cleanup scheduler', () => {
    it('runs once immediately and reports itself as running, then stops cleanly', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(logger.isCleanupRunning()).toBe(false);

        logger.startDailyCleanup();
        expect(logger.isCleanupRunning()).toBe(true);

        logger.stopDailyCleanup();
        expect(logger.isCleanupRunning()).toBe(false);
    });
});
