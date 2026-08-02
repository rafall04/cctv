/**
 * Purpose: Pin the rules that make an anonymous, unauthenticated vote safe — one per device, only
 *          on public cameras, and never leaking the negative total to visitors.
 * Caller: Backend test gate.
 * Deps: vitest, real better-sqlite3 on a temp file.
 * MainFuncs: setReaction / getPublicSummary / getAdminSummary.
 * SideEffects: Creates and removes a throwaway SQLite file. Never touches the app database.
 *
 * Real SQLite because "one vote per device" IS the composite PRIMARY KEY plus an upsert. A mocked
 * execute would prove the SQL string was passed, not that a second tap replaces the first.
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

const { default: reactions } = await import('../services/cameraReactionService.js');

const DEVICE = 'device-aaa';
const OTHER = 'device-bbb';

beforeEach(() => {
    dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'camreact-')), 'test.db');
    db = new Database(dbFile);
    db.exec(`
        CREATE TABLE areas (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            camera_class TEXT NOT NULL DEFAULT 'community',
            area_id INTEGER
        );
        CREATE TABLE camera_reactions (
            camera_id INTEGER NOT NULL,
            device_hash TEXT NOT NULL,
            value INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (camera_id, device_hash)
        );
    `);
    db.prepare('INSERT INTO areas (id, name) VALUES (3, ?)').run('KEC BOJONEGORO');
    db.prepare("INSERT INTO cameras (id, name, area_id) VALUES (1, 'PEREMPATAN', 3)").run();
});

afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

describe('voting', () => {
    it('counts one like and reflects it back to the voter', () => {
        expect(reactions.setReaction(1, DEVICE, 1)).toEqual({ likes: 1, dislikes: 0, myValue: 1 });
    });

    /* The composite primary key is the rule; a second tap must move the vote, not add one. */
    it('lets a device change its mind without adding a second vote', () => {
        reactions.setReaction(1, DEVICE, 1);
        const after = reactions.setReaction(1, DEVICE, -1);

        expect(after).toEqual({ likes: 0, dislikes: 1, myValue: -1 });
        expect(db.prepare('SELECT COUNT(*) AS n FROM camera_reactions').get().n).toBe(1);
    });

    it('withdraws the vote entirely on 0', () => {
        reactions.setReaction(1, DEVICE, 1);

        expect(reactions.setReaction(1, DEVICE, 0)).toEqual({ likes: 0, dislikes: 0, myValue: 0 });
        expect(db.prepare('SELECT COUNT(*) AS n FROM camera_reactions').get().n).toBe(0);
    });

    /* created_at must survive a change of mind — INSERT OR REPLACE would have silently reset it. */
    it('keeps the original vote time when the side changes', () => {
        reactions.setReaction(1, DEVICE, 1);
        db.prepare("UPDATE camera_reactions SET created_at = '2020-01-01 00:00:00'").run();

        reactions.setReaction(1, DEVICE, -1);

        const row = db.prepare('SELECT created_at, updated_at FROM camera_reactions').get();
        expect(row.created_at).toBe('2020-01-01 00:00:00');
        expect(row.updated_at).not.toBe('2020-01-01 00:00:00');
    });

    it('tallies separate devices independently', () => {
        reactions.setReaction(1, DEVICE, 1);
        reactions.setReaction(1, OTHER, 1);

        expect(reactions.getPublicSummary(1, DEVICE).likes).toBe(2);
    });

    it('rejects a value that is not a vote', () => {
        expect(() => reactions.setReaction(1, DEVICE, 5)).toThrow(/tidak valid/);
        expect(() => reactions.setReaction(1, DEVICE, 'suka')).toThrow(/tidak valid/);
    });

    it('refuses to vote without a device identity', () => {
        expect(() => reactions.setReaction(1, null, 1)).toThrow(/Perangkat tidak dikenali/);
    });
});

describe('public surface is community-only', () => {
    beforeEach(() => {
        db.prepare("INSERT INTO cameras (id, name, camera_class) VALUES (2, 'SEWA', 'subscriber')").run();
        db.prepare("INSERT INTO cameras (id, name, camera_class) VALUES (3, 'PRIBADI', 'owner_private')").run();
        db.prepare("INSERT INTO cameras (id, name, enabled) VALUES (4, 'DIMATIKAN', 0)").run();
    });

    it('will not accept a vote on a rented or private camera', () => {
        expect(() => reactions.setReaction(2, DEVICE, 1)).toThrow(/tidak ditemukan/);
        expect(() => reactions.setReaction(3, DEVICE, 1)).toThrow(/tidak ditemukan/);
        expect(() => reactions.setReaction(4, DEVICE, 1)).toThrow(/tidak ditemukan/);
    });

    /*
     * Same message and status for "does not exist" and "not yours to see", so the endpoint cannot
     * be walked to discover which camera ids are rented.
     */
    it('answers identically for an unknown camera and a hidden one', () => {
        const unknown = (() => { try { reactions.getPublicSummary(999, DEVICE); } catch (e) { return e; } })();
        const hidden = (() => { try { reactions.getPublicSummary(2, DEVICE); } catch (e) { return e; } })();

        expect(unknown.statusCode).toBe(hidden.statusCode);
        expect(unknown.message).toBe(hidden.message);
    });
});

describe('what each audience is shown', () => {
    beforeEach(() => {
        reactions.setReaction(1, DEVICE, -1);
        reactions.setReaction(1, OTHER, -1);
        reactions.setReaction(1, 'device-ccc', 1);
    });

    /*
     * Both totals are public (owner's decision, 2026-08-02): showing the praise while withholding
     * the complaints would make the counter an advertisement rather than a measurement.
     */
    it('publishes both totals to a visitor, plus their own vote', () => {
        expect(reactions.getPublicSummary(1, DEVICE)).toEqual({ likes: 1, dislikes: 2, myValue: -1 });
    });

    it('gives staff the same numbers, but ranked worst camera first', () => {
        db.prepare("INSERT INTO cameras (id, name, area_id) VALUES (5, 'BAGUS', 3)").run();
        reactions.setReaction(5, DEVICE, 1);

        const summary = reactions.getAdminSummary();

        expect(summary[0]).toMatchObject({ id: 1, likes: 1, dislikes: 2, areaName: 'KEC BOJONEGORO' });
        expect(summary[1]).toMatchObject({ id: 5, likes: 1, dislikes: 0 });
    });

    it('reports an unvoted camera as zero rather than omitting the count', () => {
        db.prepare("INSERT INTO cameras (id, name) VALUES (6, 'BELUM DINILAI')").run();

        expect(reactions.getPublicSummary(6, DEVICE)).toEqual({ likes: 0, dislikes: 0, myValue: 0 });
    });
});
