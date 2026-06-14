/**
 * Purpose: Self-serve voucher payment (Phase 3) — create an iPaymu QRIS order for a voucher profile,
 *          re-verify it against the gateway (webhook + poll), and on confirmation ISSUE + ACTIVATE
 *          exactly one voucher code for the buyer's device. Isolated from the billing wallet path
 *          (own voucher_orders table; reuses only the stateless iPaymu HTTP client).
 * Caller: voucherController (create + status), voucherWebhookController (gateway notify).
 * Deps: connectionPool, paymentSettingsService (gateway config), voucherService (issue/activate),
 *       utils/ipaymuClient.
 * MainFuncs: createOrder, getOrder, syncOrder, handleWebhook.
 * SideEffects: Writes voucher_orders; on confirm writes voucher_codes/voucher_redemptions (via
 *              voucherService); calls the iPaymu API.
 *
 * Exactly-once issuance: confirmation flips status pending→paid with a guarded UPDATE
 * (`WHERE status='pending'`) and then ensures a code exists (idempotent on code_id) — so a double
 * webhook, or the webhook racing a status poll, can never issue two codes. Crash-safe: a row left
 * 'paid' with code_id NULL gets its code on the next sync/get. Money is INTEGER rupiah.
 */

import crypto from 'crypto';
import { queryOne, execute } from '../database/connectionPool.js';
import paymentSettingsService from './paymentSettingsService.js';
import voucherService from './voucherService.js';
import { ipaymuRequest, interpretIpaymuTransaction } from '../utils/ipaymuClient.js';

const ORDER_EXPIRY_MINUTES = 30;
const RECHECK_THROTTLE_MS = 15000;
// Per-IP abuse cap: at most this many orders per IP within the window (each createOrder opens a REAL
// iPaymu charge, and the device cookie is attacker-controlled, so the IP cap is the load-bearing brake
// against charge-spam that would also burn the shared billing VA's gateway/fraud quota).
const ORDER_IP_CAP = 6;
const ORDER_IP_WINDOW_MINUTES = 10;

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

function notFound(message) {
    const err = new Error(message);
    err.statusCode = 404;
    return err;
}

/** iPaymu requires a buyer email; donors are anonymous, so synthesize one on the deployment host. */
function fallbackEmail(publicBaseUrl) {
    let host = 'rafnet.id';
    try {
        if (publicBaseUrl) {
            host = new URL(publicBaseUrl).hostname || host;
        }
    } catch {
        // keep default
    }
    return `donatur@${host}`;
}

class VoucherOrderService {
    /**
     * Create a pending iPaymu order for a profile, charged to the buyer's device. Reuses a still-valid
     * pending order for the same (device, profile, amount) instead of opening a duplicate charge.
     */
    async createOrder(profileId, { name = null, phone = null, deviceHash = null, methodKey = null, ip = null } = {}) {
        if (!deviceHash || typeof deviceHash !== 'string') {
            throw badRequest('deviceHash wajib');
        }
        const profile = voucherService.getProfileById(profileId);
        if (!profile || !profile.active) {
            throw badRequest('Paket voucher tidak tersedia');
        }
        if (!profile.online_purchasable) {
            throw badRequest('Paket ini tidak dijual online — minta kode ke admin');
        }
        if (!profile.price || profile.price <= 0) {
            throw badRequest('Paket ini gratis — minta kode ke admin, tidak perlu bayar');
        }

        const cfg = paymentSettingsService.getGatewayConfig();
        if (cfg.gateway !== 'ipaymu') {
            throw badRequest('Pembayaran online belum aktif. Hubungi admin untuk mendapatkan kode.');
        }

        const amount = profile.price;
        const reusable = queryOne(
            `SELECT id FROM voucher_orders
             WHERE device_hash = ? AND profile_id = ? AND amount = ? AND status = 'pending'
               AND (expires_at IS NULL OR expires_at > ?)
             ORDER BY id DESC LIMIT 1`,
            [deviceHash, profileId, amount, new Date().toISOString()]
        );
        if (reusable) {
            return this.getOrder(reusable.id);
        }

        // Per-IP cap (only NEW charges; reusing a pending order above is free).
        if (ip) {
            const recent = queryOne(
                "SELECT COUNT(*) AS n FROM voucher_orders WHERE request_ip = ? AND created_at > datetime('now', ?)",
                [ip, `-${ORDER_IP_WINDOW_MINUTES} minutes`]
            ).n;
            if (recent >= ORDER_IP_CAP) {
                const err = new Error('Terlalu banyak permintaan pembayaran dari jaringan ini. Coba lagi beberapa menit lagi.');
                err.statusCode = 429;
                err.expose = true;
                throw err;
            }
        }

        const chosen = paymentSettingsService.resolveIpaymuMethod(methodKey);
        const referenceId = `voucher-${profileId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const publicBaseUrl = cfg.publicBaseUrl;

        const { httpOk, body } = await ipaymuRequest('/api/v2/payment/direct', {
            name: (name && String(name).trim()) || 'Donatur',
            phone: (phone && String(phone).trim()) || '081234567890',
            email: fallbackEmail(publicBaseUrl),
            amount,
            notifyUrl: publicBaseUrl ? `${publicBaseUrl}/api/voucher/webhook/ipaymu` : undefined,
            referenceId,
            paymentMethod: chosen.method,
            paymentChannel: chosen.channel,
            comments: `Voucher ${profile.name}`.slice(0, 60),
        });

        const data = body?.Data || body?.data;
        if (!httpOk || !data?.TransactionId) {
            const gatewayMsg = body?.Message || body?.message || 'Gateway menolak transaksi';
            console.error('[VoucherOrder] iPaymu charge failed:', gatewayMsg);
            const err = badRequest('Pembayaran gagal dibuat di gateway. Coba lagi sebentar, atau pilih metode lain.');
            err.expose = true; // friendly message reaches the buyer
            throw err;
        }

        const expiresAt = data.Expired
            ? new Date(data.Expired).toISOString()
            : new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60 * 1000).toISOString();
        const result = execute(
            `INSERT INTO voucher_orders
               (profile_id, buyer_name, buyer_phone, device_hash, request_ip, gateway, gateway_ref, reference, amount, status, qris_payload, expires_at)
             VALUES (?, ?, ?, ?, ?, 'ipaymu', ?, ?, ?, 'pending', ?, ?)`,
            [
                profileId,
                name ? String(name).trim() : null,
                phone ? String(phone).trim() : null,
                deviceHash,
                ip || null,
                String(data.TransactionId),
                referenceId,
                amount,
                JSON.stringify({
                    method: chosen.method,
                    channel: chosen.channel,
                    label: chosen.label,
                    qr_string: data.QrString || null,
                    qr_url: data.QrImage || data.QrTemplate || null,
                    va_number: data.PaymentNo || data.VaNumber || null,
                    payment_name: data.PaymentName || chosen.label || null,
                }),
                expiresAt,
            ]
        );
        return this.getOrder(result.lastInsertRowid);
    }

    getOrder(id) {
        const order = queryOne('SELECT * FROM voucher_orders WHERE id = ?', [id]);
        if (!order) {
            throw notFound('Order tidak ditemukan');
        }
        this._expireIfDue(order);
        // Crash-recovery: a row left 'paid' without a code (process died mid-issue) gets it now.
        if (order.status === 'paid' && !order.code_id) {
            this._ensureCodeIssued(order.id);
        }
        return this._present(queryOne('SELECT * FROM voucher_orders WHERE id = ?', [id]));
    }

    /**
     * Poll entry point for the claim page: an order is visible ONLY to the device that created it
     * (the signed vdev cookie), so one buyer cannot read another's order. Re-checks the gateway,
     * then returns the presented order (issuing the code if it just turned paid).
     */
    async getOwnedOrderStatus(id, deviceHash) {
        const raw = queryOne('SELECT id, device_hash FROM voucher_orders WHERE id = ?', [id]);
        if (!raw || !deviceHash || raw.device_hash !== deviceHash) {
            throw notFound('Order tidak ditemukan');
        }
        await this.syncOrder(id);
        return this.getOrder(id);
    }

    /**
     * Re-check a pending order against iPaymu (signed request) and confirm/expire it. Safe to call
     * repeatedly: throttled by updated_at; issuance stays exactly-once via _confirmOrder.
     */
    async syncOrder(orderId) {
        const order = queryOne('SELECT * FROM voucher_orders WHERE id = ?', [orderId]);
        if (!order || order.gateway !== 'ipaymu' || order.status !== 'pending') {
            return order;
        }
        const updatedAtMs = order.updated_at
            ? new Date(`${String(order.updated_at).replace(' ', 'T')}Z`).getTime()
            : 0;
        if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < RECHECK_THROTTLE_MS) {
            return order;
        }
        // Stamp first so concurrent polls don't stampede the gateway.
        execute('UPDATE voucher_orders SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [order.id]);

        try {
            const { body } = await ipaymuRequest('/api/v2/transaction', {
                transactionId: Number(order.gateway_ref) || order.gateway_ref,
            });
            const status = interpretIpaymuTransaction(body?.Data || body?.data);
            if (status.paid) {
                if (status.amount !== null && status.amount < order.amount) {
                    console.error(`[VoucherOrder] amount mismatch order ${order.id}: ${status.amount} < ${order.amount}`);
                    return queryOne('SELECT * FROM voucher_orders WHERE id = ?', [order.id]);
                }
                this._confirmOrder(order);
            } else if (status.expired) {
                execute(
                    "UPDATE voucher_orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
                    [order.id]
                );
            }
        } catch (error) {
            console.error('[VoucherOrder] iPaymu status check failed:', error.message);
        }
        return queryOne('SELECT * FROM voucher_orders WHERE id = ?', [order.id]);
    }

    /**
     * iPaymu notify handler — the body is untrusted (no signature), so it only tells us WHICH order
     * to re-verify against the iPaymu API.
     */
    async handleWebhook(body) {
        const trxId = body?.trx_id ?? body?.transaction_id ?? body?.trxId ?? null;
        const referenceId = body?.reference_id ?? body?.referenceId ?? null;

        let order = null;
        if (trxId) {
            order = queryOne("SELECT * FROM voucher_orders WHERE gateway = 'ipaymu' AND gateway_ref = ?", [String(trxId)]);
        }
        if (!order && referenceId) {
            order = queryOne("SELECT * FROM voucher_orders WHERE gateway = 'ipaymu' AND reference = ?", [String(referenceId)]);
        }
        if (!order) {
            return { handled: false, reason: 'unknown_transaction' };
        }
        if (order.status !== 'pending') {
            return { handled: true, status: order.status };
        }
        // Force an immediate re-check regardless of the poll throttle.
        execute("UPDATE voucher_orders SET updated_at = datetime('now', '-1 minute') WHERE id = ?", [order.id]);
        const synced = await this.syncOrder(order.id);
        return { handled: true, status: synced?.status || 'pending' };
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    _confirmOrder(order) {
        // Guarded flip — only ONE caller moves pending→paid (mirrors paymentService._confirmPayment).
        // No outer transaction: voucherService.redeemCode opens its own and better-sqlite3 cannot nest.
        const flip = execute(
            "UPDATE voucher_orders SET status = 'paid', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
            [order.id]
        );
        if (flip.changes === 0) {
            // Not the flipper (a double webhook / racing poll): the other caller issues. A paid row
            // left without a code by a crash is healed by _ensureCodeIssued on the next getOrder.
            return queryOne('SELECT * FROM voucher_orders WHERE id = ?', [order.id]);
        }
        this._ensureCodeIssued(order.id);
        return queryOne('SELECT * FROM voucher_orders WHERE id = ?', [order.id]);
    }

    /** Idempotent: issue + activate exactly one code for a paid order that has none yet. */
    _ensureCodeIssued(orderId) {
        const order = queryOne('SELECT * FROM voucher_orders WHERE id = ?', [orderId]);
        if (!order || order.status !== 'paid' || order.code_id) {
            return;
        }
        const [code] = voucherService.generateCodes(order.profile_id, 1, {
            source: 'self',
            buyer_name: order.buyer_name,
            buyer_phone: order.buyer_phone,
        });
        // Claim the slot; if a concurrent caller already set code_id, drop our orphan and stop.
        const claim = execute('UPDATE voucher_orders SET code_id = ? WHERE id = ? AND code_id IS NULL', [code.id, orderId]);
        if (claim.changes === 0) {
            voucherService.revokeCode(code.id);
            return;
        }
        // Activate immediately on the buyer's device so they get instant access (also binds buyer).
        voucherService.redeemCode(code.code, {
            name: order.buyer_name,
            phone: order.buyer_phone,
            deviceHash: order.device_hash,
        });
    }

    _expireIfDue(order) {
        if (order.status === 'pending' && order.expires_at
            && new Date(order.expires_at).getTime() < Date.now()) {
            execute(
                "UPDATE voucher_orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
                [order.id]
            );
        }
    }

    _present(order) {
        if (!order) {
            return order;
        }
        let qris = null;
        if (order.qris_payload) {
            try {
                qris = JSON.parse(order.qris_payload);
            } catch {
                qris = null;
            }
        }
        let voucher = null;
        if (order.status === 'paid' && order.code_id) {
            const c = queryOne('SELECT code, expires_at FROM voucher_codes WHERE id = ?', [order.code_id]);
            const profile = voucherService.getProfileById(order.profile_id);
            voucher = {
                code: c?.code || null,
                expires_at: c?.expires_at || null,
                area_ids: profile?.area_ids || [],
            };
        }
        return {
            id: order.id,
            profile_id: order.profile_id,
            amount: order.amount,
            status: order.status,
            qris,
            expires_at: order.expires_at,
            paid_at: order.paid_at,
            voucher,
        };
    }
}

export default new VoucherOrderService();
