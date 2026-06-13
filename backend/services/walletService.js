/**
 * Purpose: Prepaid wallet ledger — atomic credit/debit with materialized balance and an
 *          auditable wallet_transactions trail (the source of truth for all money movement).
 * Caller: billingService (daily charges), paymentService (top-up credit), customer/admin routes.
 * Deps: connectionPool (queryOne/execute/transaction).
 * MainFuncs: ensureWallet, getWallet, credit, debit, getTransactions.
 * SideEffects: Writes wallets + wallet_transactions rows inside a single DB transaction.
 */

import { query, queryOne, execute, transaction } from '../database/connectionPool.js';

export const TRANSACTION_TYPES = new Set(['topup', 'charge', 'refund', 'adjustment']);

function assertValidAmount(amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
        const err = new Error('Amount must be a positive integer (rupiah)');
        err.statusCode = 400;
        throw err;
    }
}

function assertValidType(type) {
    if (!TRANSACTION_TYPES.has(type)) {
        const err = new Error(`Invalid wallet transaction type: ${type}`);
        err.statusCode = 400;
        throw err;
    }
}

class WalletService {
    ensureWallet(userId) {
        const existing = queryOne('SELECT * FROM wallets WHERE user_id = ?', [userId]);
        if (existing) {
            return existing;
        }
        execute('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
        return queryOne('SELECT * FROM wallets WHERE user_id = ?', [userId]);
    }

    getWallet(userId) {
        return this.ensureWallet(userId);
    }

    getBalance(userId) {
        return this.ensureWallet(userId).balance;
    }

    /**
     * Atomically apply a signed balance mutation + ledger row.
     * `signedAmount` > 0 credits, < 0 debits. Throws 402 when a debit would
     * take the balance below zero (unless allowNegative).
     */
    _apply({ userId, type, signedAmount, reference = null, note = null, allowNegative = false }) {
        this.ensureWallet(userId);

        const run = transaction(() => {
            const wallet = queryOne('SELECT id, balance FROM wallets WHERE user_id = ?', [userId]);
            const newBalance = wallet.balance + signedAmount;

            if (newBalance < 0 && !allowNegative) {
                const err = new Error('Insufficient wallet balance');
                err.statusCode = 402;
                throw err;
            }

            execute(
                'UPDATE wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [newBalance, userId]
            );
            const ledger = execute(
                `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, reference, note)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, type, signedAmount, newBalance, reference, note]
            );

            return {
                transaction_id: ledger.lastInsertRowid,
                user_id: userId,
                type,
                amount: signedAmount,
                balance_after: newBalance,
                reference,
            };
        });

        return run();
    }

    credit({ userId, amount, type = 'topup', reference = null, note = null }) {
        assertValidAmount(amount);
        assertValidType(type);
        return this._apply({ userId, type, signedAmount: amount, reference, note });
    }

    debit({ userId, amount, type = 'charge', reference = null, note = null, allowNegative = false }) {
        assertValidAmount(amount);
        assertValidType(type);
        return this._apply({ userId, type, signedAmount: -amount, reference, note, allowNegative });
    }

    /**
     * Admin manual correction. `signedAmount` > 0 credits (goodwill/compensation),
     * < 0 debits (refund/clawback). A debit can never drive the balance below zero
     * (_apply throws 402). Defaults the ledger type to 'adjustment' for a credit and
     * 'refund' for a debit so the customer's history reads sensibly.
     */
    adjust({ userId, signedAmount, reference = null, note = null, type = null }) {
        if (!Number.isInteger(signedAmount) || signedAmount === 0) {
            const err = new Error('Nominal penyesuaian harus bilangan bulat selain 0');
            err.statusCode = 400;
            throw err;
        }
        const resolvedType = type || (signedAmount > 0 ? 'adjustment' : 'refund');
        assertValidType(resolvedType);
        return this._apply({ userId, type: resolvedType, signedAmount, reference, note });
    }

    /**
     * Idempotent daily-charge debit: the partial UNIQUE index on
     * wallet_transactions.reference (type='charge') makes a duplicate reference
     * throw SQLITE_CONSTRAINT — translated here to {alreadyCharged: true} so
     * racing schedulers/restarts can never double-charge a day.
     */
    chargeOnce({ userId, amount, reference, note = null }) {
        try {
            const result = this.debit({ userId, amount, type: 'charge', reference, note });
            return { ...result, alreadyCharged: false };
        } catch (error) {
            if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')
                || /UNIQUE constraint failed/i.test(error?.message || '')) {
                return { alreadyCharged: true, reference };
            }
            throw error;
        }
    }

    getTransactions(userId, { limit = 50 } = {}) {
        const normalizedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
        return {
            balance: this.getBalance(userId),
            transactions: query(
                `SELECT id, type, amount, balance_after, reference, note, created_at
                 FROM wallet_transactions
                 WHERE user_id = ?
                 ORDER BY id DESC
                 LIMIT ?`,
                [userId, normalizedLimit]
            ),
        };
    }
}

export default new WalletService();
