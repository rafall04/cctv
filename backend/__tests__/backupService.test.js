/*
 * Purpose: Lock in the data-safety behaviour of backup import — restoring a backup must never
 *          destroy a live row, and must never interpolate un-whitelisted identifiers into SQL.
 * Caller:  Backend Vitest suite.
 * Deps:    better-sqlite3 (real in-memory DB), backupService.
 * MainFuncs: importBackup tests.
 * SideEffects: None — every test runs against a throwaway :memory: database.
 *
 * These tests exist because of a REAL incident (2026-06): an `INSERT OR REPLACE` deleted a live
 * customer row that merely collided on a UNIQUE column. The first test below is that exact
 * scenario; if it ever fails again, a row is being destroyed on restore.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

const h = vi.hoisted(() => ({ db: null }));

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => h.db.prepare(sql).all(params),
    queryOne: (sql, params = []) => h.db.prepare(sql).get(params),
    execute: (sql, params = []) => h.db.prepare(sql).run(params),
    transaction: (callback) => h.db.transaction(callback),
}));

const { importBackup } = await import('../services/backupService.js');

const backupOf = (data) => ({ version: '1.0', exported_at: '2026-07-28T00:00:00.000Z', data });

beforeEach(() => {
    h.db = new Database(':memory:');
    h.db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer'
        );
        CREATE TABLE areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );
    `);
});

afterEach(() => {
    h.db?.close();
    h.db = null;
});

describe('importBackup — data safety on restore', () => {
    it('REGRESSION (2026-06 incident): a backup row colliding on a UNIQUE column must NOT delete the live row', () => {
        // A real, live customer.
        h.db.prepare("INSERT INTO users (id, username, role) VALUES (5, 'budi', 'customer')").run();

        // A backup row carrying a DIFFERENT primary key but the SAME username.
        // `INSERT OR REPLACE` would delete user 5 to make room for user 99.
        const result = importBackup(
            backupOf({ users: [{ id: 99, username: 'budi', role: 'admin' }] }),
            { mode: 'replace' }
        );

        const survivor = h.db.prepare('SELECT id, username, role FROM users WHERE username = ?').get('budi');
        expect(survivor, 'the live customer row was deleted by the restore').toBeTruthy();
        expect(survivor.id).toBe(5);
        expect(survivor.role).toBe('customer');

        // Refused loudly, not silently.
        expect(h.db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(1);
        expect(result.conflicts.users).toHaveLength(1);
        expect(result.imported.users).toBe(0);
    });

    it('replace mode still updates a row in place when the primary key matches', () => {
        h.db.prepare("INSERT INTO users (id, username, role) VALUES (5, 'budi', 'customer')").run();

        const result = importBackup(
            backupOf({ users: [{ id: 5, username: 'budi-baru', role: 'admin' }] }),
            { mode: 'replace' }
        );

        const row = h.db.prepare('SELECT id, username, role FROM users WHERE id = 5').get();
        expect(row.username).toBe('budi-baru');
        expect(row.role).toBe('admin');
        expect(result.imported.users).toBe(1);
        expect(result.conflicts.users).toBeUndefined();
    });

    it('replace mode inserts rows that do not exist yet', () => {
        const result = importBackup(
            backupOf({ areas: [{ id: 1, name: 'Dander' }, { id: 2, name: 'Tanjungharjo' }] }),
            { mode: 'replace' }
        );

        expect(result.imported.areas).toBe(2);
        expect(h.db.prepare('SELECT COUNT(*) AS n FROM areas').get().n).toBe(2);
    });

    it('merge mode leaves an existing row untouched', () => {
        h.db.prepare("INSERT INTO areas (id, name) VALUES (1, 'Dander')").run();

        const result = importBackup(backupOf({ areas: [{ id: 1, name: 'DIGANTI' }] }), { mode: 'merge' });

        expect(h.db.prepare('SELECT name FROM areas WHERE id = 1').get().name).toBe('Dander');
        expect(result.imported.areas).toBe(0);
    });

    it('one unwritable row does not abort the rest of the table', () => {
        h.db.prepare("INSERT INTO users (id, username, role) VALUES (5, 'budi', 'customer')").run();

        const result = importBackup(
            backupOf({
                users: [
                    { id: 99, username: 'budi', role: 'admin' },   // collides on username
                    { id: 100, username: 'siti', role: 'customer' }, // fine
                ],
            }),
            { mode: 'replace' }
        );

        expect(result.imported.users).toBe(1);
        expect(result.conflicts.users).toHaveLength(1);
        expect(h.db.prepare('SELECT username FROM users WHERE id = 100').get().username).toBe('siti');
        expect(h.db.prepare('SELECT id FROM users WHERE username = ?').get('budi').id).toBe(5);
    });
});

describe('importBackup — identifiers are never trusted', () => {
    it('rejects a table outside the backup whitelist instead of interpolating it', () => {
        const result = importBackup(
            backupOf({ 'users; DROP TABLE users; --': [{ id: 1 }], sqlite_master: [{ name: 'x' }] }),
            { mode: 'replace' }
        );

        expect(result.skipped['users; DROP TABLE users; --']).toBe('Not an allowed backup table');
        expect(result.skipped.sqlite_master).toBe('Not an allowed backup table');
        // The real table is still there.
        expect(h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()).toBeTruthy();
    });

    it('ignores record keys that are not real columns of the table', () => {
        const result = importBackup(
            backupOf({ areas: [{ id: 1, name: 'Dander', 'evil) --': 'x', not_a_column: 9 }] }),
            { mode: 'replace' }
        );

        expect(result.imported.areas).toBe(1);
        expect(h.db.prepare('SELECT name FROM areas WHERE id = 1').get().name).toBe('Dander');
    });

    it('reports a record with no recognisable columns rather than emitting empty SQL', () => {
        const result = importBackup(backupOf({ areas: [{ bogus: 1 }] }), { mode: 'replace' });

        expect(result.imported.areas).toBe(0);
        expect(result.conflicts.areas).toHaveLength(1);
        expect(result.conflicts.areas[0].reason).toMatch(/No recognisable columns/);
    });
});
