/**
 * Purpose: Top-up payment lifecycle — create pending payments, confirm them exactly once
 *          (manual admin confirm or gateway webhook), credit the wallet, auto-resume cameras.
 * Caller: customerRoutes (create/status), billingAdminRoutes (mark-paid), billingWebhookRoutes.
 * Deps: connectionPool, walletService, billingService, crypto (midtrans signature).
 * MainFuncs: createTopup, getPayment, markPaid, handleMidtransWebhook, verifyMidtransSignature.
 * SideEffects: Writes payments rows; credits wallets; calls Midtrans API when configured.
 *
 * Gateway drivers (env BILLING_GATEWAY, default 'manual'):
 *   manual   — customer creates a top-up request and pays out-of-band (cash/transfer/static
 *              QRIS); an admin confirms with mark-paid. No external dependency.
 *   midtrans — QRIS via Midtrans Core API (env MIDTRANS_SERVER_KEY, MIDTRANS_API_BASE).
 *              The webhook is verified with the documented SHA-512 signature
 *              (order_id + status_code + gross_amount + server_key).
 *
 * Exactly-once crediting: confirmation flows through _confirmPayment, which flips
 * status pending→paid with a guarded UPDATE (`WHERE status = 'pending'`) — the wallet
 * credit only runs when that UPDATE changed a row, so double webhooks or an admin
 * racing the webhook cannot double-credit.
 */

import crypto from 'crypto';
import { query, queryOne, execute } from '../database/connectionPool.js';
import walletService from './walletService.js';
import billingService from './billingService.js';
import { logAdminAction } from './securityAuditLogger.js';

const MIN_TOPUP = 10000;       // Rp10.000 — below this, QRIS fees eat the margin
const MAX_TOPUP = 5000000;     // sanity cap
const MANUAL_EXPIRY_HOURS = 48;
const MIDTRANS_EXPIRY_MINUTES = 30;

function getGatewayName() {
    return (process.env.BILLING_GATEWAY || 'manual').toLowerCase();
}

function assertTopupAmount(amount) {
    if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
        const err = new Error(`Nominal top-up harus antara Rp${MIN_TOPUP.toLocaleString('id-ID')} dan Rp${MAX_TOPUP.toLocaleString('id-ID')}`);
        err.statusCode = 400;
        throw err;
    }
}

export function verifyMidtransSignature({ order_id, status_code, gross_amount, signature_key }, serverKey) {
    if (!order_id || !status_code || !gross_amount || !signature_key || !serverKey) {
        return false;
    }
    const expected = crypto
        .createHash('sha512')
        .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
        .digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(String(signature_key), 'utf8'));
    } catch {
        return false;
    }
}

class PaymentService {
    async createTopup(userId, amount) {
        assertTopupAmount(amount);
        const gateway = getGatewayName();

        if (gateway === 'midtrans') {
            return this._createMidtransTopup(userId, amount);
        }
        return this._createManualTopup(userId, amount);
    }

    _createManualTopup(userId, amount) {
        const gatewayRef = `manual-${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const expiresAt = new Date(Date.now() + MANUAL_EXPIRY_HOURS * 3600 * 1000).toISOString();
        const result = execute(
            `INSERT INTO payments (user_id, gateway, gateway_ref, amount, status, expires_at)
             VALUES (?, 'manual', ?, ?, 'pending', ?)`,
            [userId, gatewayRef, amount, expiresAt]
        );
        return {
            ...this.getPayment(result.lastInsertRowid),
            instructions: 'Transfer / bayar ke admin sesuai nominal, lalu tunggu konfirmasi admin. Saldo masuk otomatis setelah dikonfirmasi.',
        };
    }

    async _createMidtransTopup(userId, amount) {
        const serverKey = process.env.MIDTRANS_SERVER_KEY;
        if (!serverKey) {
            const err = new Error('Midtrans is not configured (MIDTRANS_SERVER_KEY missing)');
            err.statusCode = 503;
            throw err;
        }
        const apiBase = process.env.MIDTRANS_API_BASE
            || (process.env.MIDTRANS_PRODUCTION === 'true'
                ? 'https://api.midtrans.com'
                : 'https://api.sandbox.midtrans.com');

        const orderId = `topup-${userId}-${Date.now()}`;
        const response = await fetch(`${apiBase}/v2/charge`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
            },
            body: JSON.stringify({
                payment_type: 'qris',
                transaction_details: { order_id: orderId, gross_amount: amount },
                qris: { acquirer: 'gopay' },
                custom_expiry: { expiry_duration: MIDTRANS_EXPIRY_MINUTES, unit: 'minute' },
            }),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok || !['200', '201'].includes(String(body.status_code))) {
            console.error('[Payment] Midtrans charge failed:', body.status_message || response.status);
            const err = new Error('Gagal membuat QRIS - coba lagi sebentar lagi');
            err.statusCode = 502;
            throw err;
        }

        const qrisAction = (body.actions || []).find((a) => a.name === 'generate-qr-code');
        const expiresAt = new Date(Date.now() + MIDTRANS_EXPIRY_MINUTES * 60 * 1000).toISOString();
        const result = execute(
            `INSERT INTO payments (user_id, gateway, gateway_ref, amount, status, qris_payload, expires_at)
             VALUES (?, 'midtrans', ?, ?, 'pending', ?, ?)`,
            [userId, orderId, amount, JSON.stringify({ qr_url: qrisAction?.url || null, qr_string: body.qr_string || null }), expiresAt]
        );
        return this.getPayment(result.lastInsertRowid);
    }

    getPayment(id, userId = null) {
        const payment = queryOne('SELECT * FROM payments WHERE id = ?', [id]);
        if (!payment || (userId !== null && payment.user_id !== Number(userId))) {
            const err = new Error('Payment not found');
            err.statusCode = 404;
            throw err;
        }
        this._expireIfDue(payment);
        return this._present(queryOne('SELECT * FROM payments WHERE id = ?', [id]));
    }

    listPayments({ limit = 100 } = {}) {
        const normalizedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
        return query(
            `SELECT p.*, u.username
             FROM payments p
             JOIN users u ON u.id = p.user_id
             ORDER BY p.id DESC
             LIMIT ?`,
            [normalizedLimit]
        ).map((p) => this._present(p, { includeUsername: true }));
    }

    listPaymentsForUser(userId, { limit = 20 } = {}) {
        const normalizedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        return query(
            'SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT ?',
            [userId, normalizedLimit]
        ).map((p) => this._present(p));
    }

    /**
     * Admin manual confirmation (manual gateway, or ops override). Exactly-once
     * via the guarded status flip inside _confirmPayment.
     */
    markPaid(paymentId, request = null) {
        const payment = queryOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
        if (!payment) {
            const err = new Error('Payment not found');
            err.statusCode = 404;
            throw err;
        }
        if (payment.status !== 'pending') {
            const err = new Error(`Payment is already ${payment.status}`);
            err.statusCode = 400;
            throw err;
        }

        const confirmed = this._confirmPayment(payment);
        if (request) {
            logAdminAction({
                action: 'billing_payment_marked_paid',
                paymentId: Number(paymentId),
                userId: payment.user_id,
                amount: payment.amount,
            }, request);
        }
        return confirmed;
    }

    /**
     * Midtrans HTTP notification handler. Signature-verified; settlement
     * credits the wallet exactly once; expire/cancel/deny just mark the row.
     * Always returns {handled} — webhook endpoints should 200 on anything
     * verified so Midtrans stops retrying.
     */
    handleMidtransWebhook(body) {
        const serverKey = process.env.MIDTRANS_SERVER_KEY;
        if (!verifyMidtransSignature(body, serverKey)) {
            const err = new Error('Invalid webhook signature');
            err.statusCode = 403;
            throw err;
        }

        const payment = queryOne(
            "SELECT * FROM payments WHERE gateway = 'midtrans' AND gateway_ref = ?",
            [body.order_id]
        );
        if (!payment) {
            return { handled: false, reason: 'unknown_order' };
        }

        // Amount must match what we charged for — a tampered gross_amount with a
        // valid signature is impossible, but stay paranoid (decimal "15000.00").
        const grossAmount = Math.round(Number.parseFloat(body.gross_amount));
        if (grossAmount !== payment.amount) {
            console.error(`[Payment] Webhook amount mismatch for ${body.order_id}: ${grossAmount} != ${payment.amount}`);
            return { handled: false, reason: 'amount_mismatch' };
        }

        const status = body.transaction_status;
        if (status === 'settlement' || status === 'capture') {
            const confirmed = this._confirmPayment(payment);
            return { handled: true, status: confirmed.status };
        }
        if (['expire', 'cancel', 'deny', 'failure'].includes(status)) {
            const mapped = status === 'expire' ? 'expired' : (status === 'cancel' ? 'cancelled' : 'failed');
            execute(
                "UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
                [mapped, payment.id]
            );
            return { handled: true, status: mapped };
        }
        // pending / authorize / refund states: acknowledge without changes.
        return { handled: true, status: payment.status };
    }

    _confirmPayment(payment) {
        // Guarded flip — only ONE caller can move pending→paid.
        const flip = execute(
            "UPDATE payments SET status = 'paid', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
            [payment.id]
        );
        if (flip.changes === 0) {
            return this._present(queryOne('SELECT * FROM payments WHERE id = ?', [payment.id]));
        }

        walletService.credit({
            userId: payment.user_id,
            amount: payment.amount,
            type: 'topup',
            reference: `payment:${payment.id}`,
            note: `Top-up via ${payment.gateway}`,
        });

        // Re-activate any suspended cameras this balance now covers.
        try {
            billingService.tryResumeForUser(payment.user_id);
        } catch (error) {
            console.error('[Payment] Post-topup resume failed:', error.message);
        }

        return this._present(queryOne('SELECT * FROM payments WHERE id = ?', [payment.id]));
    }

    _expireIfDue(payment) {
        if (payment.status === 'pending' && payment.expires_at
            && new Date(payment.expires_at).getTime() < Date.now()) {
            execute(
                "UPDATE payments SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
                [payment.id]
            );
        }
    }

    _present(payment, { includeUsername = false } = {}) {
        if (!payment) {
            return payment;
        }
        let qris = null;
        if (payment.qris_payload) {
            try {
                qris = JSON.parse(payment.qris_payload);
            } catch {
                qris = null;
            }
        }
        const presented = {
            id: payment.id,
            user_id: payment.user_id,
            gateway: payment.gateway,
            gateway_ref: payment.gateway_ref,
            amount: payment.amount,
            status: payment.status,
            qris,
            expires_at: payment.expires_at,
            paid_at: payment.paid_at,
            created_at: payment.created_at,
        };
        if (includeUsername && payment.username) {
            presented.username = payment.username;
        }
        return presented;
    }
}

export default new PaymentService();
