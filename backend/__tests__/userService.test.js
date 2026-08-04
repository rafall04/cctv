/**
 * Purpose: Lock the account-deletion guards in userService — who may be deleted, and the audit row
 *          that must survive it. Written after a real bug: the last-admin check counted admins
 *          globally and refused EVERY deletion on a single-admin install (production is one).
 * Caller: backend test gate.
 * Deps: vitest, better-sqlite3 (in-memory), mocked connectionPool + audit logger.
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
    logUserCreated: vi.fn(),
    logUserUpdated: vi.fn(),
    logUserDeleted: vi.fn(),
    logPasswordChanged: vi.fn(),
    logPasswordValidationFailed: vi.fn(),
}));

const { default: userService } = await import('../services/userService.js');
const { logUserDeleted } = await import('../services/securityAuditLogger.js');

const asAdmin = (id = 1) => ({ user: { id, username: 'admin' }, ip: '127.0.0.1' });
const idOf = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;

beforeEach(() => {
    vi.clearAllMocks();
    db.exec('DROP TABLE IF EXISTS users');
    db.exec('DROP TABLE IF EXISTS audit_logs');
    // Column names mirror the real schema so the fixture cannot drift from what ships.
    db.exec(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        role TEXT NOT NULL,
        phone TEXT, email TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec(`CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER, action TEXT, details TEXT, ip_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    // Exactly the production shape at the time of the bug: one admin, one viewer.
    db.exec(`INSERT INTO users (username, password_hash, role) VALUES
        ('admin', 'x', 'admin'), ('penonton', 'x', 'viewer'), ('pelanggan', 'x', 'customer')`);
});

describe('deleteUser', () => {
    it('deletes a non-admin even when only one admin exists', async () => {
        // The regression: production has a single admin, so this path refused every deletion.
        expect(db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c).toBe(1);

        await userService.deleteUser(idOf('penonton'), asAdmin());

        expect(db.prepare("SELECT id FROM users WHERE username = 'penonton'").get()).toBeUndefined();
    });

    it('deletes a customer even when only one admin exists', async () => {
        await userService.deleteUser(idOf('pelanggan'), asAdmin());
        expect(db.prepare("SELECT id FROM users WHERE username = 'pelanggan'").get()).toBeUndefined();
    });

    it('still refuses to delete the last remaining admin', async () => {
        db.exec("INSERT INTO users (username, password_hash, role) VALUES ('admin2', 'x', 'admin')");
        // admin2 is deletable (two admins), then the survivor is not.
        await userService.deleteUser(idOf('admin2'), asAdmin());

        db.exec("INSERT INTO users (username, password_hash, role) VALUES ('admin3', 'x', 'admin')");
        const survivor = idOf('admin3');
        db.prepare("DELETE FROM users WHERE username = 'admin'").run();
        // Now admin3 is the only admin left; deleting it must fail.
        await expect(userService.deleteUser(survivor, asAdmin(99)))
            .rejects.toThrow('Cannot delete the last admin user');
        expect(db.prepare('SELECT id FROM users WHERE id = ?').get(survivor)).toBeDefined();
    });

    it('refuses to delete your own account', async () => {
        await expect(userService.deleteUser(1, asAdmin(1)))
            .rejects.toThrow('Cannot delete your own account');
    });

    it('reports a missing user as 404, not as an admin-count problem', async () => {
        await expect(userService.deleteUser(4242, asAdmin())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('leaves an audit row naming who deleted whom', async () => {
        await userService.deleteUser(idOf('penonton'), asAdmin());

        const row = db.prepare("SELECT * FROM audit_logs WHERE action = 'DELETE_USER'").get();
        expect(row).toBeDefined();
        expect(row.user_id).toBe(1);
        expect(row.details).toContain('penonton');
        expect(logUserDeleted).toHaveBeenCalledTimes(1);
    });
});
