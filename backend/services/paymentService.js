/**
 * Purpose: Top-up payment lifecycle — create pending payments, confirm them exactly once
 *          (manual admin confirm or gateway webhook), credit the wallet, auto-resume cameras.
 * Caller: customerRoutes (create/status), billingAdminRoutes (mark-paid), billingWebhookRoutes.
 * Deps: connectionPool, walletService, billingService, crypto (midtrans signature).
 * MainFuncs: createTopup, getPayment, markPaid, handleMidtransWebhook, verifyMidtransSignature.
 * SideEffects: Writes payments rows; credits wallets; calls Midtrans API when configured.
 *
 * Gateway selection + credentials come from paymentSettingsService (admin-editable
 * settings table, falling back to env). Drivers:
 *   manual   — customer creates a top-up request and pays out-of-band (cash/transfer/static
 *              QRIS); an admin confirms with mark-paid. No external dependency.
 *   midtrans — QRIS via Midtrans Core API (server key from settings/MIDTRANS_SERVER_KEY).
 *              The webhook is verified with the documented SHA-512 signature
 *              (order_id + status_code + gross_amount + server_key).
 *   ipaymu   — iPaymu API v2 direct payment, method/channel chosen from the admin-curated
 *              list (QRIS / VA bank / convenience store). Credentials + enabled methods are
 *              all configured in the admin page (no .env required).
 *              iPaymu callbacks carry no verifiable signature, so the webhook NEVER
 *              trusts its body: it re-queries the transaction status from the iPaymu
 *              API (signed request) before crediting. The same re-query also runs on
 *              customer status polls (throttled), so deployments that cannot receive
 *              webhooks still confirm within one poll interval.
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
import paymentSettingsService from './paymentSettingsService.js';
import { logAdminAction } from './securityAuditLogger.js';

const MIN_TOPUP = 10000;       // Rp10.000 — below this, QRIS fees eat the margin
const MAX_TOPUP = 5000000;     // sanity cap
const MANUAL_EXPIRY_HOURS = 48;
const MIDTRANS_EXPIRY_MINUTES = 30;

// Gateway selection + credentials now come from the admin-editable settings (DB),
// falling back to env for backward compatibility. See paymentSettingsService.
function getGatewayName() {
    return paymentSettingsService.getGatewayConfig().gateway;
}

function assertTopupAmount(amount) {
    if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
        const err = new Error(`Nominal top-up harus antara Rp${MIN_TOPUP.toLocaleString('id-ID')} dan Rp${MAX_TOPUP.toLocaleString('id-ID')}`);
        err.statusCode = 400;
        throw err;
    }
}

// ----------------------------------------------------------------------
// iPaymu API v2 helpers
// ----------------------------------------------------------------------

const IPAYMU_EXPIRY_MINUTES = 30;
const IPAYMU_RECHECK_THROTTLE_MS = 15000;

function getIpaymuConfig() {
    const { ipaymu } = paymentSettingsService.getGatewayConfig();
    return { va: ipaymu.va, apiKey: ipaymu.apiKey, baseUrl: ipaymu.baseUrl };
}

/**
 * iPaymu v2 request signature:
 *   stringToSign = "{METHOD}:{VA}:{lowercase sha256(jsonBody)}:{API_KEY}"
 *   signature    = HMAC-SHA256(stringToSign, API_KEY) hex
 * Sent via `va`, `signature`, `timestamp` (YYYYMMDDhhmmss) headers.
 */
export function buildIpaymuSignature({ method = 'POST', va, apiKey, body }) {
    const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex').toLowerCase();
    const stringToSign = `${method.toUpperCase()}:${va}:${bodyHash}:${apiKey}`;
    return crypto.createHmac('sha256', apiKey).update(stringToSign, 'utf8').digest('hex');
}

function ipaymuTimestamp(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function ipaymuRequest(path, payload) {
    const { va, apiKey, baseUrl } = getIpaymuConfig();
    if (!va || !apiKey) {
        const err = new Error('iPaymu is not configured (IPAYMU_VA / IPAYMU_API_KEY missing)');
        err.statusCode = 503;
        throw err;
    }
    const body = JSON.stringify(payload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                va,
                signature: buildIpaymuSignature({ method: 'POST', va, apiKey, body }),
                timestamp: ipaymuTimestamp(),
            },
            body,
            signal: controller.signal,
        });
        const json = await response.json().catch(() => ({}));
        return { httpOk: response.ok, body: json };
    } finally {
        clearTimeout(timeout);
    }
}

/** Normalize iPaymu transaction-check payloads into {paid, expired, amount}. */
export function interpretIpaymuTransaction(data) {
    if (!data) {
        return { paid: false, expired: false, amount: null };
    }
    const statusDesc = String(data.StatusDesc ?? data.status_desc ?? '').toLowerCase();
    const statusCode = Number(data.Status ?? data.status);
    const paid = statusDesc === 'berhasil' || statusDesc === 'success' || statusCode === 1 || statusCode === 6;
    const expired = statusDesc.includes('expired') || statusDesc.includes('kadaluarsa') || statusCode === -2;
    const rawAmount = data.Amount ?? data.amount ?? data.Total ?? data.total ?? null;
    const amount = rawAmount === null ? null : Math.round(Number.parseFloat(rawAmount));
    return { paid, expired, amount: Number.isFinite(amount) ? amount : null };
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
    async createTopup(userId, amount, methodKey = null) {
        assertTopupAmount(amount);
        const gateway = getGatewayName();

        if (gateway === 'midtrans') {
            return this._createMidtransTopup(userId, amount);
        }
        if (gateway === 'ipaymu') {
            return this._createIpaymuTopup(userId, amount, methodKey);
        }
        return this._createManualTopup(userId, amount);
    }

    async _createIpaymuTopup(userId, amount, methodKey = null) {
        const customer = queryOne('SELECT username, phone, email FROM users WHERE id = ?', [userId]);
        const { publicBaseUrl } = paymentSettingsService.getGatewayConfig();
        // Admin-curated method (VA bank / QRIS / convenience store). Falls back to the
        // first enabled method (and finally QRIS) so a stale pick can't break the charge.
        const chosen = paymentSettingsService.resolveIpaymuMethod(methodKey);
        const referenceId = `topup-${userId}-${Date.now()}`;

        const { httpOk, body } = await ipaymuRequest('/api/v2/payment/direct', {
            name: customer?.username || `user-${userId}`,
            phone: customer?.phone || '081234567890',
            email: customer?.email || `user${userId}@noemail.local`,
            amount,
            notifyUrl: publicBaseUrl ? `${publicBaseUrl}/api/billing/webhook/ipaymu` : undefined,
            referenceId,
            paymentMethod: chosen.method,
            paymentChannel: chosen.channel,
            comments: 'Top-up saldo CCTV',
        });

        const data = body?.Data || body?.data;
        if (!httpOk || !data?.TransactionId) {
            console.error('[Payment] iPaymu charge failed:', body?.Message || body?.message || 'unknown');
            const err = new Error('Gagal membuat pembayaran - coba lagi sebentar lagi');
            err.statusCode = 502;
            throw err;
        }

        const expiresAt = data.Expired
            ? new Date(data.Expired).toISOString()
            : new Date(Date.now() + IPAYMU_EXPIRY_MINUTES * 60 * 1000).toISOString();
        const result = execute(
            `INSERT INTO payments (user_id, gateway, gateway_ref, amount, status, qris_payload, expires_at)
             VALUES (?, 'ipaymu', ?, ?, 'pending', ?, ?)`,
            [
                userId,
                String(data.TransactionId),
                amount,
                // Method-agnostic instruction blob (kept under qris_payload for schema
                // compatibility): QR for qris, VA number for va, payment code for cstore.
                JSON.stringify({
                    method: chosen.method,
                    channel: chosen.channel,
                    label: chosen.label,
                    qr_string: data.QrString || null,
                    qr_url: data.QrImage || data.QrTemplate || null,
                    va_number: data.PaymentNo || data.VaNumber || null,
                    payment_name: data.PaymentName || chosen.label || null,
                    reference_id: referenceId,
                }),
                expiresAt,
            ]
        );
        return this.getPayment(result.lastInsertRowid);
    }

    /**
     * Re-check a pending iPaymu payment against the gateway (signed request) and
     * confirm/expire it accordingly. Safe to call repeatedly: throttled by
     * updated_at, and crediting stays exactly-once via _confirmPayment. Called by
     * the webhook (mandatory verification) and by customer status polls (fallback
     * for deployments that cannot receive webhooks).
     */
    async syncIpaymuPayment(paymentId) {
        const payment = queryOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
        if (!payment || payment.gateway !== 'ipaymu' || payment.status !== 'pending') {
            return payment;
        }
        // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" (UTC) — normalize to ISO.
        const updatedAtMs = payment.updated_at
            ? new Date(`${String(payment.updated_at).replace(' ', 'T')}Z`).getTime()
            : 0;
        if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < IPAYMU_RECHECK_THROTTLE_MS) {
            return payment;
        }
        // Stamp the attempt first so concurrent polls don't stampede the gateway.
        execute('UPDATE payments SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [payment.id]);

        try {
            const { body } = await ipaymuRequest('/api/v2/transaction', {
                transactionId: Number(payment.gateway_ref) || payment.gateway_ref,
            });
            const status = interpretIpaymuTransaction(body?.Data || body?.data);

            if (status.paid) {
                if (status.amount !== null && status.amount < payment.amount) {
                    console.error(`[Payment] iPaymu amount mismatch for payment ${payment.id}: ${status.amount} < ${payment.amount}`);
                    return queryOne('SELECT * FROM payments WHERE id = ?', [payment.id]);
                }
                this._confirmPayment(payment);
            } else if (status.expired) {
                execute(
                    "UPDATE payments SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
                    [payment.id]
                );
            }
        } catch (error) {
            console.error('[Payment] iPaymu status check failed:', error.message);
        }
        return queryOne('SELECT * FROM payments WHERE id = ?', [payment.id]);
    }

    /**
     * iPaymu notify handler. The body is untrusted (no signature) — it only tells
     * us WHICH payment to re-verify against the iPaymu API.
     */
    async handleIpaymuWebhook(body) {
        const trxId = body?.trx_id ?? body?.transaction_id ?? body?.trxId ?? null;
        const referenceId = body?.reference_id ?? body?.referenceId ?? null;

        let payment = null;
        if (trxId) {
            payment = queryOne(
                "SELECT * FROM payments WHERE gateway = 'ipaymu' AND gateway_ref = ?",
                [String(trxId)]
            );
        }
        if (!payment && referenceId) {
            payment = queryOne(
                "SELECT * FROM payments WHERE gateway = 'ipaymu' AND qris_payload LIKE ?",
                [`%"reference_id":"${String(referenceId).replace(/"/g, '')}"%`]
            );
        }
        if (!payment) {
            return { handled: false, reason: 'unknown_transaction' };
        }
        if (payment.status !== 'pending') {
            return { handled: true, status: payment.status };
        }

        // Force an immediate re-check regardless of the poll throttle.
        execute("UPDATE payments SET updated_at = datetime('now', '-1 minute') WHERE id = ?", [payment.id]);
        const synced = await this.syncIpaymuPayment(payment.id);
        return { handled: true, status: synced?.status || 'pending' };
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
        const { midtrans } = paymentSettingsService.getGatewayConfig();
        const serverKey = midtrans.serverKey;
        if (!serverKey) {
            const err = new Error('Midtrans belum dikonfigurasi (server key kosong)');
            err.statusCode = 503;
            throw err;
        }
        const apiBase = midtrans.apiBase;

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
        const serverKey = paymentSettingsService.getGatewayConfig().midtrans.serverKey;
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

    /**
     * Admin "Cek Saldo iPaymu" — a read-only signed balance call that proves the
     * configured VA + API key + mode actually work, WITHOUT creating any transaction.
     * Always resolves (never throws) so the admin UI can show a clean ok/error.
     */
    async testIpaymuConnection() {
        const { va, apiKey } = getIpaymuConfig();
        if (!va || !apiKey) {
            return { ok: false, message: 'VA / API key belum diisi.' };
        }
        try {
            const { httpOk, body } = await ipaymuRequest('/api/v2/balance', { account: va });
            const status = Number(body?.Status);
            if (httpOk && (status === 200 || body?.Success === true)) {
                const balance = body?.Data?.Balance ?? body?.Data?.balance ?? null;
                return { ok: true, message: 'Koneksi iPaymu berhasil.', balance };
            }
            return {
                ok: false,
                message: body?.Message || body?.message || 'Gagal — periksa VA, API key, dan mode (sandbox/produksi).',
            };
        } catch (error) {
            return { ok: false, message: error.message || 'Gagal menghubungi iPaymu.' };
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
