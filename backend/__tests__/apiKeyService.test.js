/**
 * Purpose: Lock down API-key generation/validation/revocation (auth perimeter, previously 0 tests).
 * Caller: backend test gate; part of the auth front-door coverage backfill.
 * Deps: vitest, better-sqlite3 (in-memory), mocked database.js.
 * SideEffects: In-memory database only — never touches prod data.
 */
import { beforeEach, describe, expect, it } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

vi.mock('../database/database.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));

import {
    generateApiKey,
    hashApiKey,
    timingSafeEqual,
    createApiKey,
    validateApiKey,
    revokeApiKey,
    getActiveApiKeys,
    hasActiveApiKeys,
    cleanupExpiredKeys,
} from '../services/apiKeyService.js';

const daysFromNow = (d) => { const t = new Date(); t.setDate(t.getDate() + d); return t.toISOString(); };

beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS api_keys');
    db.exec(`CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT NOT NULL,
        client_name TEXT,
        expires_at TEXT,
        last_used_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
});

describe('apiKeyService — primitives', () => {
    it('generates a unique 64-char hex key', () => {
        const a = generateApiKey();
        const b = generateApiKey();
        expect(a).toMatch(/^[a-f0-9]{64}$/);
        expect(a).not.toBe(b);
    });

    it('hashApiKey is deterministic SHA-256 hex', () => {
        expect(hashApiKey('abc')).toBe(hashApiKey('abc'));
        expect(hashApiKey('abc')).toMatch(/^[a-f0-9]{64}$/);
        expect(hashApiKey('abc')).not.toBe(hashApiKey('abd'));
    });

    it('timingSafeEqual: true only for identical strings', () => {
        expect(timingSafeEqual('same', 'same')).toBe(true);
        expect(timingSafeEqual('same', 'diff')).toBe(false);
        expect(timingSafeEqual('short', 'longer')).toBe(false); // different length
        expect(timingSafeEqual(null, 'x')).toBe(false);
        expect(timingSafeEqual(123, 123)).toBe(false); // non-strings
    });
});

describe('apiKeyService — lifecycle', () => {
    it('create → validate round-trips and returns the raw key once', () => {
        const created = createApiKey('frontend');
        expect(created.apiKey).toMatch(/^[a-f0-9]{64}$/);
        const v = validateApiKey(created.apiKey);
        expect(v.valid).toBe(true);
        expect(v.clientId).toBe(created.id);
        expect(v.clientName).toBe('frontend');
    });

    it('validate rejects missing / malformed / unknown keys', () => {
        expect(validateApiKey(undefined).reason).toBe('missing');
        expect(validateApiKey('not-hex!!').reason).toBe('invalid_format');
        expect(validateApiKey('a'.repeat(64)).reason).toBe('invalid'); // well-formed but unknown
    });

    it('validate updates last_used_at on success', () => {
        const created = createApiKey('frontend');
        validateApiKey(created.apiKey);
        const row = db.prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(created.id);
        expect(row.last_used_at).toBeTruthy();
    });

    it('an expired key is rejected with reason "expired"', () => {
        const raw = generateApiKey();
        db.prepare('INSERT INTO api_keys (key_hash, client_name, expires_at, is_active) VALUES (?, ?, ?, 1)')
            .run(hashApiKey(raw), 'old', daysFromNow(-1));
        expect(validateApiKey(raw).reason).toBe('expired');
    });

    it('revoked keys stop validating and drop from the active list', () => {
        const created = createApiKey('frontend');
        expect(revokeApiKey(created.id)).toBe(true);
        expect(validateApiKey(created.apiKey).valid).toBe(false);
        expect(getActiveApiKeys().find((k) => k.id === created.id)).toBeUndefined();
    });

    it('hasActiveApiKeys reflects table state', () => {
        expect(hasActiveApiKeys()).toBe(false);
        createApiKey('frontend');
        expect(hasActiveApiKeys()).toBe(true);
    });

    it('cleanupExpiredKeys deletes only expired rows', () => {
        createApiKey('valid', 30); // future expiry
        db.prepare('INSERT INTO api_keys (key_hash, client_name, expires_at, is_active) VALUES (?, ?, ?, 1)')
            .run(hashApiKey(generateApiKey()), 'old', daysFromNow(-1));
        expect(cleanupExpiredKeys()).toBe(1);
        expect(getActiveApiKeys().length).toBe(1);
    });
});
