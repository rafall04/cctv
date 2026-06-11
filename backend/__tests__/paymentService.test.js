/**
 * Purpose: Verify top-up payment lifecycle — manual flow, Midtrans webhook signature
 *          verification, exactly-once wallet crediting, amount-mismatch rejection, expiry.
 * Caller: Backend focused test gate for paymentService.
 * Deps: vitest, better-sqlite3 (in-memory), crypto; mocked connectionPool/billing deps.
 * MainFuncs: payment lifecycle tests.
 * SideEffects: In-memory database only.
 */

import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { tryResumeMock } = vi.hoisted(() => ({ tryResumeMock: vi.fn(() => ({ resumedCameraIds: [] })) }));

vi.mock('../services/billingService.js', () => ({
    default: { tryResumeForUser: tryResumeMock },
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(),
}));

import paymentService, { verifyMidtransSignature } from '../services/paymentService.js';
import walletService from '../services/walletService.js';

const SERVER_KEY = 'test-server-key';

function midtransSignature(orderId, statusCode, grossAmount) {
    return crypto.createHash('sha512')
        .update(`${orderId}${statusCode}${grossAmount}${SERVER_KEY}`)
        .digest('hex');
}

beforeEach(() => {
    process.env.BILLING_GATEWAY = 'manual';
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    tryResumeMock.mockClear();
    db.exec(`
        DROP TABLE IF EXISTS wallets;
        DROP TABLE IF EXISTS wallet_transactions;
        DROP TABLE IF EXISTS payments;
        DROP TABLE IF EXISTS users;
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL
        );
        CREATE TABLE wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            balance INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            reference TEXT,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX idx_wallet_transactions_charge_ref
        ON wallet_transactions(reference)
        WHERE type = 'charge' AND reference IS NOT NULL;
        CREATE TABLE payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            gateway TEXT NOT NULL,
            gateway_ref TEXT UNIQUE,
            amount INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            qris_payload TEXT,
            expires_at TEXT,
            paid_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, username) VALUES (42, 'budi');
    `);
});

afterEach(() => {
    delete process.env.MIDTRANS_SERVER_KEY;
});

describe('paymentService', () => {
    it('manual top-up creates a pending payment with instructions', async () => {
        const payment = await paymentService.createTopup(42, 25000);
        expect(payment.status).toBe('pending');
        expect(payment.gateway).toBe('manual');
        expect(payment.amount).toBe(25000);
        expect(payment.instructions).toContain('konfirmasi admin');
        expect(walletService.getBalance(42)).toBe(0); // nothing credited yet
    });

    it('rejects out-of-range top-up amounts', async () => {
        await expect(paymentService.createTopup(42, 500)).rejects.toMatchObject({ statusCode: 400 });
        await expect(paymentService.createTopup(42, 99999999)).rejects.toMatchObject({ statusCode: 400 });
        await expect(paymentService.createTopup(42, 15000.5)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('markPaid credits the wallet exactly once and triggers camera resume', async () => {
        const payment = await paymentService.createTopup(42, 25000);

        const confirmed = paymentService.markPaid(payment.id);
        expect(confirmed.status).toBe('paid');
        expect(walletService.getBalance(42)).toBe(25000);
        expect(tryResumeMock).toHaveBeenCalledWith(42);

        // Second confirm attempt: rejected, no double credit.
        expect(() => paymentService.markPaid(payment.id)).toThrowError(
            expect.objectContaining({ statusCode: 400 })
        );
        expect(walletService.getBalance(42)).toBe(25000);
    });

    it('verifyMidtransSignature accepts the documented SHA-512 and rejects tampering', () => {
        const valid = {
            order_id: 'topup-42-1',
            status_code: '200',
            gross_amount: '25000.00',
            signature_key: midtransSignature('topup-42-1', '200', '25000.00'),
        };
        expect(verifyMidtransSignature(valid, SERVER_KEY)).toBe(true);
        expect(verifyMidtransSignature({ ...valid, gross_amount: '99000.00' }, SERVER_KEY)).toBe(false);
        expect(verifyMidtransSignature({ ...valid, signature_key: 'deadbeef' }, SERVER_KEY)).toBe(false);
        expect(verifyMidtransSignature(valid, 'wrong-key')).toBe(false);
    });

    it('settlement webhook credits exactly once even when delivered twice', async () => {
        db.prepare(`INSERT INTO payments (user_id, gateway, gateway_ref, amount, status)
                    VALUES (42, 'midtrans', 'topup-42-99', 25000, 'pending')`).run();
        const body = {
            order_id: 'topup-42-99',
            status_code: '200',
            gross_amount: '25000.00',
            transaction_status: 'settlement',
            signature_key: midtransSignature('topup-42-99', '200', '25000.00'),
        };

        const first = paymentService.handleMidtransWebhook(body);
        const second = paymentService.handleMidtransWebhook(body);

        expect(first.handled).toBe(true);
        expect(second.handled).toBe(true);
        expect(walletService.getBalance(42)).toBe(25000); // credited once
        expect(db.prepare("SELECT COUNT(*) AS n FROM wallet_transactions WHERE type='topup'").get().n).toBe(1);
    });

    it('webhook with invalid signature throws 403 and changes nothing', () => {
        db.prepare(`INSERT INTO payments (user_id, gateway, gateway_ref, amount, status)
                    VALUES (42, 'midtrans', 'topup-42-77', 25000, 'pending')`).run();
        expect(() => paymentService.handleMidtransWebhook({
            order_id: 'topup-42-77',
            status_code: '200',
            gross_amount: '25000.00',
            transaction_status: 'settlement',
            signature_key: 'forged',
        })).toThrowError(expect.objectContaining({ statusCode: 403 }));
        expect(walletService.getBalance(42)).toBe(0);
    });

    it('webhook amount mismatch is refused without crediting', () => {
        db.prepare(`INSERT INTO payments (user_id, gateway, gateway_ref, amount, status)
                    VALUES (42, 'midtrans', 'topup-42-55', 25000, 'pending')`).run();
        const body = {
            order_id: 'topup-42-55',
            status_code: '200',
            gross_amount: '10000.00', // valid signature but wrong amount vs our record
            transaction_status: 'settlement',
            signature_key: midtransSignature('topup-42-55', '200', '10000.00'),
        };
        const result = paymentService.handleMidtransWebhook(body);
        expect(result.handled).toBe(false);
        expect(result.reason).toBe('amount_mismatch');
        expect(walletService.getBalance(42)).toBe(0);
    });

    it('expire webhook marks the payment expired without credit', () => {
        db.prepare(`INSERT INTO payments (user_id, gateway, gateway_ref, amount, status)
                    VALUES (42, 'midtrans', 'topup-42-33', 25000, 'pending')`).run();
        const result = paymentService.handleMidtransWebhook({
            order_id: 'topup-42-33',
            status_code: '407',
            gross_amount: '25000.00',
            transaction_status: 'expire',
            signature_key: midtransSignature('topup-42-33', '407', '25000.00'),
        });
        expect(result.status).toBe('expired');
        expect(walletService.getBalance(42)).toBe(0);
    });

    it('stale pending payments flip to expired when read past expiry', async () => {
        const payment = await paymentService.createTopup(42, 25000);
        db.prepare("UPDATE payments SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(payment.id);

        const read = paymentService.getPayment(payment.id, 42);
        expect(read.status).toBe('expired');
        expect(() => paymentService.markPaid(payment.id)).toThrowError(
            expect.objectContaining({ statusCode: 400 })
        );
    });

    it('getPayment scoped to a user hides other users payments', async () => {
        const payment = await paymentService.createTopup(42, 25000);
        expect(() => paymentService.getPayment(payment.id, 99)).toThrowError(
            expect.objectContaining({ statusCode: 404 })
        );
    });
});
