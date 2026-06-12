/**
 * Purpose: Verify per-customer private areas ("Area Saya") — owner-scoped CRUD, case-insensitive
 *          per-owner uniqueness (two customers may both use "Rumah"), delete unlinks own cameras,
 *          and the cross-tenant guard (can't attach/list/delete another customer's area by id).
 * Caller: Backend focused test gate for customerAreaService.
 * Deps: vitest, better-sqlite3 (in-memory); mocked connectionPool.
 * MainFuncs: customer area CRUD + ownership tests.
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
    transaction: (callback) => db.transaction(callback),
}));

import customerAreaService from '../services/customerAreaService.js';

function seedSchema() {
    db.exec(`
        DROP TABLE IF EXISTS customer_areas;
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS users;
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT DEFAULT 'customer');
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_user_id INTEGER,
            customer_area_id INTEGER,
            updated_at TEXT
        );
        CREATE TABLE customer_areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(owner_user_id, name)
        );
        INSERT INTO users (id, username) VALUES (42, 'budi'), (99, 'siti');
    `);
}

describe('customerAreaService', () => {
    beforeEach(() => {
        seedSchema();
    });

    it('creates an area trimmed/normalized and returns it with a zero camera count', () => {
        const area = customerAreaService.createOwnArea(42, '  Rumah   Utama  ');
        expect(area.name).toBe('Rumah Utama'); // collapsed whitespace
        expect(area.camera_count).toBe(0);
        expect(area.id).toBeTruthy();
    });

    it('rejects blank or over-long names with 400', () => {
        expect(() => customerAreaService.createOwnArea(42, '   ')).toThrowError(expect.objectContaining({ statusCode: 400 }));
        expect(() => customerAreaService.createOwnArea(42, 'x'.repeat(41))).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });

    it('rejects case-insensitive duplicates within the same owner', () => {
        customerAreaService.createOwnArea(42, 'Rumah');
        expect(() => customerAreaService.createOwnArea(42, 'rumah')).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });

    it('lets two different customers both use the same area name', () => {
        const a = customerAreaService.createOwnArea(42, 'Rumah');
        const b = customerAreaService.createOwnArea(99, 'Rumah');
        expect(a.id).not.toBe(b.id);
        expect(customerAreaService.listOwnAreas(42).map((x) => x.name)).toEqual(['Rumah']);
        expect(customerAreaService.listOwnAreas(99).map((x) => x.name)).toEqual(['Rumah']);
    });

    it('lists only the owner areas with accurate camera counts', () => {
        const rumah = customerAreaService.createOwnArea(42, 'Rumah');
        customerAreaService.createOwnArea(42, 'Toko');
        customerAreaService.createOwnArea(99, 'Gudang'); // other tenant
        db.prepare('INSERT INTO cameras (name, owner_user_id, customer_area_id) VALUES (?, 42, ?)').run('Cam A', rumah.id);
        db.prepare('INSERT INTO cameras (name, owner_user_id, customer_area_id) VALUES (?, 42, ?)').run('Cam B', rumah.id);

        const list = customerAreaService.listOwnAreas(42);
        expect(list.map((a) => a.name)).toEqual(['Rumah', 'Toko']); // NOCASE sorted, owner-scoped
        expect(list.find((a) => a.name === 'Rumah').camera_count).toBe(2);
        expect(list.find((a) => a.name === 'Toko').camera_count).toBe(0);
    });

    it('resolveOwnAreaId: clears on empty, returns own id, blocks foreign/invalid ids', () => {
        const mine = customerAreaService.createOwnArea(42, 'Rumah');
        const theirs = customerAreaService.createOwnArea(99, 'Punya Siti');

        expect(customerAreaService.resolveOwnAreaId(42, '')).toBe(null);
        expect(customerAreaService.resolveOwnAreaId(42, null)).toBe(null);
        expect(customerAreaService.resolveOwnAreaId(42, undefined)).toBe(null);
        expect(customerAreaService.resolveOwnAreaId(42, mine.id)).toBe(mine.id);
        // Cross-tenant: customer 42 may NOT attach to customer 99's area.
        expect(() => customerAreaService.resolveOwnAreaId(42, theirs.id)).toThrowError(expect.objectContaining({ statusCode: 400 }));
        expect(() => customerAreaService.resolveOwnAreaId(42, 999999)).toThrowError(expect.objectContaining({ statusCode: 400 }));
        expect(() => customerAreaService.resolveOwnAreaId(42, 'abc')).toThrowError(expect.objectContaining({ statusCode: 400 }));
    });

    it('deletes only own areas and unlinks just the owner cameras', () => {
        const mine = customerAreaService.createOwnArea(42, 'Rumah');
        const theirs = customerAreaService.createOwnArea(99, 'Punya Siti');
        db.prepare('INSERT INTO cameras (name, owner_user_id, customer_area_id) VALUES (?, 42, ?)').run('Cam A', mine.id);

        // Cross-tenant delete is refused.
        expect(() => customerAreaService.deleteOwnArea(42, theirs.id)).toThrowError(expect.objectContaining({ statusCode: 400 }));

        const removed = customerAreaService.deleteOwnArea(42, mine.id);
        expect(removed.id).toBe(mine.id);
        expect(db.prepare('SELECT COUNT(*) AS n FROM customer_areas WHERE id = ?').get(mine.id).n).toBe(0);
        // The owner's camera is unlinked, not deleted.
        const cam = db.prepare("SELECT customer_area_id FROM cameras WHERE name = 'Cam A'").get();
        expect(cam.customer_area_id).toBe(null);
    });
});
