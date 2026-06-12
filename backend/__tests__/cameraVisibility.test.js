/**
 * Purpose: Verify PUBLIC_LIVE_SQL — the single predicate every public live surface uses —
 *          shows community + published-and-actively-paid subscriber cameras, and NOTHING else
 *          (suspended-public, private subscriber, owner_private all stay hidden). This is the
 *          anti-leak guard for the customer "publish camera" feature.
 * Caller: Backend focused test gate.
 * Deps: vitest, better-sqlite3 (in-memory).
 * MainFuncs: predicate selection test.
 * SideEffects: In-memory database only.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { PUBLIC_LIVE_SQL } from '../utils/cameraVisibility.js';

const db = new Database(':memory:');

function seed() {
    db.exec(`
        DROP TABLE IF EXISTS cameras;
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY,
            name TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            camera_class TEXT,
            is_public INTEGER NOT NULL DEFAULT 0,
            billing_status TEXT
        );
        INSERT INTO cameras (id, name, camera_class, is_public, billing_status) VALUES
            (1, 'community',    'community',     0, NULL),
            (2, 'pub-active',   'subscriber',    1, 'active'),
            (3, 'pub-suspend',  'subscriber',    1, 'suspended'),
            (4, 'priv-active',  'subscriber',    0, 'active'),
            (5, 'owner-priv',   'owner_private', 1, 'active');
    `);
}

describe('PUBLIC_LIVE_SQL', () => {
    beforeEach(seed);

    it('selects ONLY community + published-and-active subscriber cameras', () => {
        const rows = db.prepare(
            `SELECT c.name FROM cameras c WHERE c.enabled = 1 AND ${PUBLIC_LIVE_SQL} ORDER BY c.id`
        ).all();
        expect(rows.map((r) => r.name)).toEqual(['community', 'pub-active']);
    });

    it('drops a published subscriber camera the instant it suspends', () => {
        db.prepare("UPDATE cameras SET billing_status = 'suspended' WHERE id = 2").run();
        const rows = db.prepare(`SELECT c.id FROM cameras c WHERE ${PUBLIC_LIVE_SQL}`).all();
        expect(rows.map((r) => r.id)).toEqual([1]); // only community remains
    });

    it('never exposes owner_private even when is_public is somehow set', () => {
        const rows = db.prepare(`SELECT c.id FROM cameras c WHERE ${PUBLIC_LIVE_SQL}`).all();
        expect(rows.map((r) => r.id)).not.toContain(5);
    });
});
