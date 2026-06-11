/**
 * Purpose: Verify prepaid wallet ledger semantics against real SQLite — atomic balance math,
 *          insufficient-balance rejection, and DB-level daily-charge idempotency.
 * Caller: Backend focused test gate for walletService.
 * Deps: vitest, better-sqlite3 (in-memory), mocked connectionPool backed by the real DB.
 * MainFuncs: wallet credit/debit/chargeOnce tests.
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

import walletService from '../services/walletService.js';

beforeEach(() => {
    db.exec(`
        DROP TABLE IF EXISTS wallets;
        DROP TABLE IF EXISTS wallet_transactions;
        CREATE TABLE wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            balance INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('topup', 'charge', 'refund', 'adjustment')),
            amount INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            reference TEXT,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX idx_wallet_transactions_charge_ref
        ON wallet_transactions(reference)
        WHERE type = 'charge' AND reference IS NOT NULL;
    `);
});

describe('walletService', () => {
    it('creates wallets lazily with zero balance', () => {
        const wallet = walletService.getWallet(5);
        expect(wallet.balance).toBe(0);
        expect(walletService.getBalance(5)).toBe(0);
    });

    it('credit raises the balance and writes a matching ledger row', () => {
        const result = walletService.credit({ userId: 5, amount: 25000, reference: 'payment:1' });
        expect(result.balance_after).toBe(25000);

        const ledger = db.prepare('SELECT * FROM wallet_transactions WHERE user_id = 5').all();
        expect(ledger).toHaveLength(1);
        expect(ledger[0].amount).toBe(25000);
        expect(ledger[0].balance_after).toBe(25000);
        expect(walletService.getBalance(5)).toBe(25000);
    });

    it('debit lowers the balance and records a negative ledger amount', () => {
        walletService.credit({ userId: 5, amount: 20000 });
        const result = walletService.debit({ userId: 5, amount: 700, reference: 'charge:1:2026-06-11' });
        expect(result.balance_after).toBe(19300);
        expect(result.amount).toBe(-700);
    });

    it('rejects a debit that would go below zero with 402 and leaves no trace', () => {
        walletService.credit({ userId: 5, amount: 500 });
        expect(() => walletService.debit({ userId: 5, amount: 700 })).toThrowError(
            expect.objectContaining({ statusCode: 402 })
        );
        expect(walletService.getBalance(5)).toBe(500);
        expect(db.prepare("SELECT COUNT(*) AS n FROM wallet_transactions WHERE type = 'charge'").get().n).toBe(0);
    });

    it('rejects non-integer and non-positive amounts', () => {
        expect(() => walletService.credit({ userId: 5, amount: 100.5 })).toThrowError(
            expect.objectContaining({ statusCode: 400 })
        );
        expect(() => walletService.credit({ userId: 5, amount: -50 })).toThrowError(
            expect.objectContaining({ statusCode: 400 })
        );
        expect(() => walletService.debit({ userId: 5, amount: 0 })).toThrowError(
            expect.objectContaining({ statusCode: 400 })
        );
    });

    it('chargeOnce debits exactly once per reference (DB unique guard)', () => {
        walletService.credit({ userId: 5, amount: 10000 });

        const first = walletService.chargeOnce({ userId: 5, amount: 700, reference: 'charge:9:2026-06-11' });
        expect(first.alreadyCharged).toBe(false);
        expect(walletService.getBalance(5)).toBe(9300);

        const second = walletService.chargeOnce({ userId: 5, amount: 700, reference: 'charge:9:2026-06-11' });
        expect(second.alreadyCharged).toBe(true);
        expect(walletService.getBalance(5)).toBe(9300); // unchanged — no double charge
    });

    it('chargeOnce still surfaces insufficient balance as 402', () => {
        walletService.credit({ userId: 5, amount: 100 });
        expect(() => walletService.chargeOnce({ userId: 5, amount: 700, reference: 'charge:9:2026-06-12' }))
            .toThrowError(expect.objectContaining({ statusCode: 402 }));
    });

    it('getTransactions returns balance plus newest-first ledger', () => {
        walletService.credit({ userId: 5, amount: 20000 });
        walletService.debit({ userId: 5, amount: 700, reference: 'charge:1:2026-06-11' });

        const result = walletService.getTransactions(5);
        expect(result.balance).toBe(19300);
        expect(result.transactions).toHaveLength(2);
        expect(result.transactions[0].type).toBe('charge'); // newest first
    });
});
