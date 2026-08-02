/**
 * Purpose: Cover the admin catalogue rules — what an operator may change, and the two price
 *          contradictions that would produce a dead end on the public page.
 * Caller: Backend test gate.
 * Deps: vitest, real better-sqlite3 on a temp file.
 * MainFuncs: createProduct / updateProduct / listAll cases.
 * SideEffects: Creates and removes a throwaway SQLite file. Never touches the app database.
 *
 * Run against a REAL SQLite file rather than a mock: the UNIQUE constraint on `key` and the
 * INTEGER-rupiah column are part of what is being asserted, and a mocked `execute` proves neither.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

let db;
let dbFile;

vi.mock('../database/connectionPool.js', () => ({
    execute: (sql, params = []) => db.prepare(sql).run(...params),
    queryOne: (sql, params = []) => db.prepare(sql).get(...params),
    query: (sql, params = []) => db.prepare(sql).all(...params),
}));

// Token issuance is a different concern; the catalogue must not need a token table to be edited.
vi.mock('../services/playbackTokenService.js', () => ({ default: { createToken: vi.fn() } }));

const { default: playbackProductService } = await import('../services/playbackProductService.js');
const { default: playbackCoverageService } = await import('../services/playbackCoverageService.js');

const PAID = { key: 'quarterly', label: 'Tiga Bulan', price_rupiah: 200000, window_hours: 2160, validity_days: 90 };

beforeEach(() => {
    dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pbprod-')), 'test.db');
    db = new Database(dbFile);

    /*
     * Both list methods now measure real footage depth before answering, so the catalogue cannot be
     * read without a cameras table. Coverage itself is asserted in playbackCoverageService.test.js;
     * here it only has to be answerable. The cache is module-level, so it is cleared per case or the
     * first test's database would keep answering for the rest.
     */
    db.exec(`
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_class TEXT NOT NULL DEFAULT 'community',
            enabled INTEGER NOT NULL DEFAULT 1,
            enable_recording INTEGER NOT NULL DEFAULT 1,
            recording_duration_hours INTEGER NOT NULL DEFAULT 4
        );
    `);
    db.prepare('INSERT INTO cameras (id) VALUES (1)').run();
    playbackCoverageService.clearCache();

    db.exec(`
        CREATE TABLE playback_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            description TEXT,
            price_rupiah INTEGER NOT NULL DEFAULT 0,
            window_hours INTEGER NOT NULL,
            validity_days INTEGER NOT NULL,
            is_trial INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    db.prepare(
        `INSERT INTO playback_products (key, label, price_rupiah, window_hours, validity_days, is_trial, enabled, sort_order)
         VALUES ('trial','Coba Gratis',0,1,3,1,1,0), ('monthly','Bulanan',75000,720,30,0,1,3)`
    ).run();
});

afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

describe('admin catalogue — what the operator can see', () => {
    it('lists DISABLED packages too, or they could never be switched back on', () => {
        playbackProductService.updateProduct(2, { enabled: 0 });

        expect(playbackProductService.listPublic().map((p) => p.key)).toEqual(['trial']);
        expect(playbackProductService.listAll().map((p) => p.key)).toEqual(['trial', 'monthly']);
    });
});

describe('admin catalogue — editing', () => {
    it('changes price, depth, validity and availability together', () => {
        const updated = playbackProductService.updateProduct(2, {
            label: 'Bulanan Hemat',
            price_rupiah: 60000,
            window_hours: 480,
            validity_days: 30,
            enabled: 0,
        });

        expect(updated.label).toBe('Bulanan Hemat');
        expect(updated.price_rupiah).toBe(60000);
        expect(updated.window_hours).toBe(480);
        expect(updated.enabled).toBe(0);
    });

    /*
     * playbackOrderService refuses any non-trial product priced at 0, so this would render a "Beli"
     * button that can never complete. Rejecting it here means the operator learns why.
     */
    it('refuses to make a PAID package free instead of creating an unbuyable button', () => {
        expect(() => playbackProductService.updateProduct(2, { price_rupiah: 0 })).toThrow(/harga di atas 0/);
    });

    /** The trial flow never charges, so a price on it would be displayed and then ignored. */
    it('refuses to put a price on the free trial', () => {
        expect(() => playbackProductService.updateProduct(1, { price_rupiah: 5000 })).toThrow(/harus berharga 0/);
    });

    it('rejects a negative or fractional price rather than storing it', () => {
        expect(() => playbackProductService.updateProduct(2, { price_rupiah: -1 })).toThrow(/bilangan bulat/);
        expect(() => playbackProductService.updateProduct(2, { price_rupiah: 1000.5 })).toThrow(/bilangan bulat/);
    });

    it('keeps depth and validity at a meaningful minimum', () => {
        expect(() => playbackProductService.updateProduct(2, { window_hours: 0 })).toThrow(/minimal 1 jam/);
        expect(() => playbackProductService.updateProduct(2, { validity_days: 0 })).toThrow(/minimal 1 hari/);
    });

    it('reports a missing package as 404 rather than failing silently', () => {
        expect(() => playbackProductService.updateProduct(999, { price_rupiah: 1 })).toThrow(/tidak ditemukan/);
    });
});

describe('admin catalogue — adding a package', () => {
    it('adds a paid package that the public list then carries', () => {
        const created = playbackProductService.createProduct(PAID);

        expect(created.key).toBe('quarterly');
        expect(created.is_trial).toBe(0);
        expect(created.enabled).toBe(1);
        expect(playbackProductService.listPublic().map((p) => p.key)).toContain('quarterly');
    });

    /*
     * The trial is found by the literal key 'trial' and its once-per-device guarantee is a PRIMARY
     * KEY on playback_trial_claims. A second trial-flagged row would get neither, so the flag is
     * simply not the operator's to set.
     */
    it('never lets a second package call itself the trial', () => {
        const created = playbackProductService.createProduct({ ...PAID, is_trial: 1 });

        expect(created.is_trial).toBe(0);
    });

    it('refuses a duplicate key instead of overwriting the existing package', () => {
        expect(() => playbackProductService.createProduct({ ...PAID, key: 'monthly' })).toThrow(/sudah dipakai/);

        // The price of the real 'monthly' must still be there — the failed create replaced nothing.
        expect(playbackProductService.getByKey('monthly').price_rupiah).toBe(75000);
    });

    it('rejects keys that would not survive being used as a lookup value', () => {
        expect(() => playbackProductService.createProduct({ ...PAID, key: 'Paket Bulanan!' })).toThrow(/huruf kecil/);
        expect(() => playbackProductService.createProduct({ ...PAID, key: 'x' })).toThrow(/huruf kecil/);
    });

    it('requires a name and a real price', () => {
        expect(() => playbackProductService.createProduct({ ...PAID, label: '  ' })).toThrow(/Nama paket wajib/);
        expect(() => playbackProductService.createProduct({ ...PAID, price_rupiah: 0 })).toThrow(/harga di atas 0/);
    });

    it('normalises the key so case alone cannot create a near-duplicate', () => {
        expect(playbackProductService.createProduct({ ...PAID, key: 'QUARTERLY' }).key).toBe('quarterly');
    });
});
