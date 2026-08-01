/**
 * Purpose: Cover permanent deletion of a playback token — what it removes, what it must NOT remove,
 *          and that it leaves a trace.
 * Caller: Backend test gate.
 * Deps: vitest, real better-sqlite3 on a temp file, mocked securityAuditLogger.
 * MainFuncs: deletePlaybackToken cases.
 * SideEffects: Creates and removes a throwaway SQLite file. Never touches the app database.
 *
 * Run against a REAL SQLite file rather than a mock: the whole point of this operation is the
 * schema's ON DELETE behaviour (CASCADE for sessions/rules, SET NULL for audit logs), and a mocked
 * `execute` proves nothing about whether those actually fire.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const { logSecurityEvent } = vi.hoisted(() => ({ logSecurityEvent: vi.fn() }));

vi.mock('../services/securityAuditLogger.js', () => ({ logSecurityEvent }));

let db;
let dbFile;

vi.mock('../database/connectionPool.js', () => ({
    execute: (sql, params = []) => db.prepare(sql).run(...params),
    queryOne: (sql, params = []) => db.prepare(sql).get(...params),
    query: (sql, params = []) => db.prepare(sql).all(...params),
}));

const { deletePlaybackToken } = await import('../services/playbackTokenDeletionService.js');

beforeEach(() => {
    dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tokdel-')), 'test.db');
    db = new Database(dbFile);
    // The pragma the real pool sets on its write connection. Without it SQLite ignores every
    // ON DELETE clause below and this suite would pass while production orphaned rows.
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE playback_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT,
            revoked_at TEXT,
            expires_at TEXT
        );
        CREATE TABLE playback_token_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_id INTEGER,
            FOREIGN KEY (token_id) REFERENCES playback_tokens(id) ON DELETE CASCADE
        );
        CREATE TABLE playback_token_camera_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_id INTEGER,
            FOREIGN KEY (token_id) REFERENCES playback_tokens(id) ON DELETE CASCADE
        );
        CREATE TABLE playback_token_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_id INTEGER,
            event_type TEXT,
            FOREIGN KEY (token_id) REFERENCES playback_tokens(id) ON DELETE SET NULL
        );
    `);
    logSecurityEvent.mockClear();
});

afterEach(() => {
    db?.close();
    try { fs.rmSync(path.dirname(dbFile), { recursive: true, force: true }); } catch { /* temp dir */ }
});

/** Insert a token plus one row in every table that hangs off it. */
function seedToken({ label = 'Uji Coba', revoked_at = null, expires_at = null } = {}) {
    const { lastInsertRowid: id } = db
        .prepare('INSERT INTO playback_tokens (label, revoked_at, expires_at) VALUES (?, ?, ?)')
        .run(label, revoked_at, expires_at);
    db.prepare('INSERT INTO playback_token_sessions (token_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO playback_token_camera_rules (token_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO playback_token_audit_logs (token_id, event_type) VALUES (?, ?)')
        .run(id, 'access_segments');
    return id;
}

const countIn = (table, id) =>
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE token_id = ?`).get(id).n;

describe('deletePlaybackToken', () => {
    it('removes the token, its sessions and its camera rules', () => {
        const id = seedToken();

        deletePlaybackToken(id, {});

        expect(db.prepare('SELECT COUNT(*) AS n FROM playback_tokens').get().n).toBe(0);
        expect(countIn('playback_token_sessions', id)).toBe(0);
        expect(countIn('playback_token_camera_rules', id)).toBe(0);
    });

    it('KEEPS the audit history — who accessed what is a record, not the token\'s property', () => {
        const id = seedToken();

        deletePlaybackToken(id, {});

        const logs = db.prepare('SELECT token_id, event_type FROM playback_token_audit_logs').all();
        expect(logs).toHaveLength(1);
        expect(logs[0].event_type).toBe('access_segments');
        expect(logs[0].token_id).toBeNull();
    });

    it('reports an expired or revoked token as not active', () => {
        const revoked = seedToken({ label: 'Dicabut', revoked_at: '2026-01-01 00:00:00' });
        expect(deletePlaybackToken(revoked, {})).toEqual({ id: revoked, label: 'Dicabut', wasActive: false });

        const expired = seedToken({ label: 'Kedaluwarsa', expires_at: '2020-01-01 00:00:00' });
        expect(deletePlaybackToken(expired, {}).wasActive).toBe(false);
    });

    it('flags a LIVE token so the caller can warn that access was just cut off', () => {
        const live = seedToken({ label: 'Selamanya' });
        expect(deletePlaybackToken(live, {}).wasActive).toBe(true);

        const future = seedToken({ label: 'Masih berlaku', expires_at: '2099-01-01 00:00:00' });
        expect(deletePlaybackToken(future, {}).wasActive).toBe(true);
    });

    it('leaves a security-audit trace, since the act itself cannot be reconstructed afterwards', () => {
        const id = seedToken({ label: 'Uji Coba' });

        deletePlaybackToken(id, { user: { username: 'admin' } });

        expect(logSecurityEvent).toHaveBeenCalledWith(
            'PLAYBACK_TOKEN_DELETED',
            expect.objectContaining({ tokenId: id, label: 'Uji Coba', wasActive: true, username: 'admin' }),
            expect.anything(),
        );
    });

    it('answers 404 for an unknown token and 400 for a malformed id', () => {
        expect(() => deletePlaybackToken(4242, {})).toThrow(expect.objectContaining({ statusCode: 404 }));
        expect(() => deletePlaybackToken('abc', {})).toThrow(expect.objectContaining({ statusCode: 400 }));
        expect(() => deletePlaybackToken(-1, {})).toThrow(expect.objectContaining({ statusCode: 400 }));
        expect(logSecurityEvent).not.toHaveBeenCalled();
    });
});
