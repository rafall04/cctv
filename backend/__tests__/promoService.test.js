/**
 * Purpose: Verify promo codes — bonus computation (percent cap / flat), top-up validation
 *          (invalid/expired/min-topup/quota/per-user), gift redemption (atomic credit + limits),
 *          and applyTopupBonus (credits once, idempotent per payment, capped at confirm time).
 * Caller: Backend focused test gate for promoService.
 * Deps: vitest, better-sqlite3 (in-memory); mocked connectionPool + audit logger.
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

vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: vi.fn() }));

import promoService from '../services/promoService.js';
import walletService from '../services/walletService.js';

function seed() {
    db.exec(`
        DROP TABLE IF EXISTS promo_codes;
        DROP TABLE IF EXISTS promo_redemptions;
        DROP TABLE IF EXISTS wallets;
        DROP TABLE IF EXISTS wallet_transactions;
        DROP TABLE IF EXISTS users;
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
        CREATE TABLE wallets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, balance INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE wallet_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount INTEGER, balance_after INTEGER, reference TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE promo_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, type TEXT NOT NULL, value INTEGER NOT NULL,
            max_bonus INTEGER, min_topup INTEGER NOT NULL DEFAULT 0, max_uses INTEGER, used_count INTEGER NOT NULL DEFAULT 0,
            per_user_limit INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, expires_at TEXT, description TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE promo_redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, promo_id INTEGER, user_id INTEGER, payment_id INTEGER, bonus_amount INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO users (id, username) VALUES (42, 'budi'), (99, 'siti');
    `);
}

beforeEach(seed);

describe('promoService.computeBonus', () => {
    it('percent (with cap) and flat', () => {
        expect(promoService.computeBonus({ type: 'percent', value: 10, max_bonus: null }, 50000)).toBe(5000);
        expect(promoService.computeBonus({ type: 'percent', value: 10, max_bonus: 3000 }, 50000)).toBe(3000); // capped
        expect(promoService.computeBonus({ type: 'flat', value: 5000 }, 50000)).toBe(5000);
        expect(promoService.computeBonus({ type: 'gift', value: 10000 }, 50000)).toBe(0);
    });
});

describe('promoService.validateForTopup', () => {
    it('returns the bonus for a valid percent code', () => {
        promoService.createPromo({ code: 'hemat10', type: 'percent', value: 10 });
        expect(promoService.validateForTopup('HEMAT10', 42, 50000)).toMatchObject({ code: 'HEMAT10', bonus: 5000 });
    });

    it('rejects unknown/gift/expired/min-topup codes', () => {
        promoService.createPromo({ code: 'gift5k', type: 'gift', value: 5000 });
        promoService.createPromo({ code: 'min50', type: 'flat', value: 2000, min_topup: 50000 });
        promoService.createPromo({ code: 'expired', type: 'flat', value: 1000, expires_at: '2000-01-01T00:00:00.000Z' });

        expect(() => promoService.validateForTopup('NOPE', 42, 50000)).toThrowError(expect.objectContaining({ statusCode: 400 }));
        expect(() => promoService.validateForTopup('GIFT5K', 42, 50000)).toThrowError(/Tukar Kode/);
        expect(() => promoService.validateForTopup('MIN50', 42, 25000)).toThrowError(/minimal/);
        expect(() => promoService.validateForTopup('EXPIRED', 42, 50000)).toThrowError(/kedaluwarsa/);
    });
});

describe('promoService.redeemGift', () => {
    it('credits the wallet, records the redemption, and bumps used_count', () => {
        const promo = promoService.createPromo({ code: 'gift5k', type: 'gift', value: 5000 });
        const res = promoService.redeemGift('GIFT5K', 42);
        expect(res.bonus).toBe(5000);
        expect(walletService.getBalance(42)).toBe(5000);
        expect(db.prepare('SELECT used_count FROM promo_codes WHERE id = ?').get(promo.id).used_count).toBe(1);
        expect(db.prepare('SELECT COUNT(*) AS n FROM promo_redemptions WHERE promo_id = ?').get(promo.id).n).toBe(1);
    });

    it('enforces per-user limit and total quota', () => {
        promoService.createPromo({ code: 'once', type: 'gift', value: 1000, per_user_limit: 1, max_uses: 2 });
        promoService.redeemGift('ONCE', 42);
        // same user again → blocked
        expect(() => promoService.redeemGift('ONCE', 42)).toThrowError(/sudah memakai/);
        // another user ok (2nd of 2)
        promoService.redeemGift('ONCE', 99);
        // total quota exhausted → a 3rd user blocked
        db.prepare("INSERT INTO users (id, username) VALUES (7, 'x')").run();
        expect(() => promoService.redeemGift('ONCE', 7)).toThrowError(/Kuota/);
        expect(walletService.getBalance(42)).toBe(1000); // never double-credited
    });

    it('refuses to redeem a top-up (non-gift) code as a gift', () => {
        promoService.createPromo({ code: 'pct', type: 'percent', value: 10 });
        expect(() => promoService.redeemGift('PCT', 42)).toThrowError(/bonus top-up/);
    });
});

describe('promoService.applyTopupBonus', () => {
    it('credits the stored bonus exactly once (idempotent per payment)', () => {
        const promo = promoService.createPromo({ code: 'flat3k', type: 'flat', value: 3000 });
        const payment = { id: 501, user_id: 42, promo_code: 'FLAT3K', promo_bonus: 3000 };

        expect(promoService.applyTopupBonus(payment)).toBe(3000);
        expect(walletService.getBalance(42)).toBe(3000);
        // Replay (e.g. double webhook) → no second credit.
        expect(promoService.applyTopupBonus(payment)).toBe(null);
        expect(walletService.getBalance(42)).toBe(3000);
        expect(db.prepare('SELECT used_count FROM promo_codes WHERE id = ?').get(promo.id).used_count).toBe(1);
    });

    it('skips the bonus (no throw) when the code hit its cap between create and confirm', () => {
        promoService.createPromo({ code: 'cap1', type: 'flat', value: 2000, max_uses: 1 });
        // First payment consumes the only use.
        expect(promoService.applyTopupBonus({ id: 1, user_id: 42, promo_code: 'CAP1', promo_bonus: 2000 })).toBe(2000);
        // Second payment (different) → quota gone → skipped, wallet for 99 untouched.
        expect(promoService.applyTopupBonus({ id: 2, user_id: 99, promo_code: 'CAP1', promo_bonus: 2000 })).toBe(null);
        expect(walletService.getBalance(99)).toBe(0);
    });

    it('does nothing when the payment has no promo', () => {
        expect(promoService.applyTopupBonus({ id: 9, user_id: 42, promo_code: null, promo_bonus: 0 })).toBe(null);
    });
});

describe('promoService admin CRUD', () => {
    it('validates code format, type, and uniqueness', () => {
        promoService.createPromo({ code: 'ok1', type: 'flat', value: 1000 });
        expect(() => promoService.createPromo({ code: 'ok1', type: 'flat', value: 1 })).toThrowError(/sudah ada/);
        expect(() => promoService.createPromo({ code: 'x', type: 'flat', value: 1 })).toThrowError(/3-30/);
        expect(() => promoService.createPromo({ code: 'bad', type: 'weird', value: 1 })).toThrowError(/percent, flat/);
        expect(() => promoService.createPromo({ code: 'pctbig', type: 'percent', value: 150 })).toThrowError(/maksimal 100/);
    });

    it('updates and deletes', () => {
        const p = promoService.createPromo({ code: 'edit', type: 'flat', value: 1000 });
        promoService.updatePromo(p.id, { active: false, value: 2000 });
        const updated = db.prepare('SELECT active, value FROM promo_codes WHERE id = ?').get(p.id);
        expect(updated.active).toBe(0);
        expect(updated.value).toBe(2000);
        promoService.deletePromo(p.id);
        expect(db.prepare('SELECT id FROM promo_codes WHERE id = ?').get(p.id)).toBeUndefined();
    });
});
