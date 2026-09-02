/**
 * Purpose: Self-serve playback access — open an iPaymu order for a playback product, re-verify it
 *          against the gateway (webhook + poll), and on confirmation issue EXACTLY ONE playback token
 *          for the buyer's device.
 * Caller: playbackAccessController (create + status), playbackAccessWebhookController (gateway notify).
 * Deps: connectionPool, paymentSettingsService, playbackProductService, utils/ipaymuClient.
 * MainFuncs: createOrder, getOrder, getOwnedOrderStatus, syncOrder, handleWebhook.
 * SideEffects: Writes playback_orders; on confirm writes playback_tokens (via playbackProductService);
 *              calls the iPaymu API.
 *
 * EXACTLY-ONCE ISSUANCE — the whole point of this file
 * Confirmation flips pending→paid with a guarded `UPDATE ... WHERE status='pending'`, and only the
 * caller whose UPDATE actually changed a row goes on to mint. A double webhook, or a webhook racing a
 * status poll, therefore cannot mint two tokens for one payment. Minting itself is idempotent a second
 * time over: the slot is claimed with `WHERE token_id IS NULL`, and a caller that loses that race
 * revokes the token it just made rather than leaving it live and unreferenced.
 *
 * Crash-safe: a row left 'paid' with token_id NULL — process died between the flip and the mint — is
 * healed on the next getOrder/sync. Nothing is lost, and the buyer's next poll fixes it silently.
 *
 * The webhook body is UNTRUSTED. iPaymu's notify carries no signature we verify, so it is used only to
 * learn WHICH order to look at; the paid/not-paid decision always comes from a signed request we make
 * to iPaymu ourselves. Money is INTEGER rupiah.
 */

import crypto from 'crypto';
import { query, queryOne, execute } from '../database/connectionPool.js';
import paymentSettingsService from './paymentSettingsService.js';
import playbackProductService from './playbackProductService.js';
import playbackTokenService from './playbackTokenService.js';
import playbackTokenRenewalService from './playbackTokenRenewalService.js';
import { ipaymuRequest, interpretIpaymuTransaction } from '../utils/ipaymuClient.js';

const ORDER_EXPIRY_MINUTES = 30;
const RECHECK_THROTTLE_MS = 15000;
// Each createOrder opens a REAL charge at the gateway, and the device cookie is attacker-controlled,
// so the per-IP cap — not the device hash — is the load-bearing brake against charge-spam.
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

/** iPaymu requires a buyer email; buyers here are anonymous, so synthesize one on the deployment host. */
function fallbackEmail(publicBaseUrl) {
    let host = 'rafnet.id';
    try {
        if (publicBaseUrl) {
            host = new URL(publicBaseUrl).hostname || host;
        }
    } catch {
        // keep default
    }
    return `pembeli@${host}`;
}

// Short human-friendly recovery code shown to the buyer, so an anonymous buyer can retrieve their
// token later (phone + code) without any WhatsApp/Telegram delivery. Ambiguous chars removed.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRecoveryCode() {
    const bytes = crypto.randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i++) out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    return out;
}

class PlaybackOrderService {
    /**
     * Reuses a still-valid pending order for the same (device, product, amount) rather than opening a
     * duplicate charge — a buyer who reloads the page must not be billed twice for one intent.
     */
    async createOrder(productKey, { name = null, phone = null, deviceHash = null, methodKey = null, ip = null } = {}) {
        const product = this._resolvePurchasableProduct(productKey);
        return this._openOrder({ product, name, phone, deviceHash, methodKey, ip, orderKind: 'purchase', renewTokenId: null });
    }

    /**
     * Renewal (perpanjang): open an iPaymu order that, once paid, EXTENDS the buyer's existing token
     * instead of minting a new one. The buyer proves ownership by their access code (share key).
     */
    async createRenewalOrder(accessCode, productKey, { name = null, phone = null, deviceHash = null, methodKey = null, ip = null } = {}) {
        const token = playbackTokenRenewalService.findTokenByAccessCode(accessCode);
        if (!token) throw badRequest('Kode akses tidak ditemukan — periksa kembali kodenya');
        if (token.revoked_at) throw badRequest('Token ini sudah dicabut dan tidak bisa diperpanjang');
        const product = this._resolvePurchasableProduct(productKey);
        return this._openOrder({ product, name, phone, deviceHash, methodKey, ip, orderKind: 'renewal', renewTokenId: token.id });
    }

    _resolvePurchasableProduct(productKey) {
        const product = playbackProductService.getByKey(productKey);
        if (!product || !product.enabled) {
            throw badRequest('Paket tidak tersedia');
        }
        if (product.is_trial || !product.price_rupiah || product.price_rupiah <= 0) {
            throw badRequest('Paket ini gratis — pakai tombol coba gratis, tidak perlu bayar');
        }
        return product;
    }

    /** Shared charge+order-open for both purchase and renewal. */
    async _openOrder({ product, name = null, phone = null, deviceHash = null, methodKey = null, ip = null, orderKind = 'purchase', renewTokenId = null }) {
        if (!deviceHash || typeof deviceHash !== 'string') {
            throw badRequest('deviceHash wajib');
        }
        const cfg = paymentSettingsService.getGatewayConfig();
        if (cfg.gateway !== 'ipaymu') {
            throw badRequest('Pembayaran online belum aktif. Hubungi admin.');
        }

        const amount = product.price_rupiah;
        const reusable = queryOne(
            `SELECT id FROM playback_orders
             WHERE device_hash = ? AND product_id = ? AND amount = ? AND status = 'pending'
               AND order_kind = ? AND COALESCE(renew_token_id, 0) = COALESCE(?, 0)
               AND (expires_at IS NULL OR expires_at > ?)
             ORDER BY id DESC LIMIT 1`,
            [deviceHash, product.id, amount, orderKind, renewTokenId, new Date().toISOString()]
        );
        if (reusable) {
            return this.getOrder(reusable.id);
        }

        // Only NEW charges count against the cap; reusing a pending order above is free.
        if (ip) {
            const recent = queryOne(
                "SELECT COUNT(*) AS n FROM playback_orders WHERE request_ip = ? AND created_at > datetime('now', ?)",
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
        const referenceId = `pbk-${product.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const publicBaseUrl = cfg.publicBaseUrl;

        const { httpOk, body } = await ipaymuRequest('/api/v2/payment/direct', {
            name: (name && String(name).trim()) || 'Pembeli',
            phone: (phone && String(phone).trim()) || '081234567890',
            email: fallbackEmail(publicBaseUrl),
            amount,
            notifyUrl: publicBaseUrl ? `${publicBaseUrl}/api/playback-access/webhook/ipaymu` : undefined,
            referenceId,
            paymentMethod: chosen.method,
            paymentChannel: chosen.channel,
            comments: `Playback ${product.label}`.slice(0, 60),
        });

        const data = body?.Data || body?.data;
        if (!httpOk || !data?.TransactionId) {
            const gatewayMsg = body?.Message || body?.message || 'Gateway menolak transaksi';
            console.error('[PlaybackOrder] iPaymu charge failed:', gatewayMsg);
            const err = badRequest('Pembayaran gagal dibuat di gateway. Coba lagi sebentar, atau pilih metode lain.');
            err.expose = true;
            throw err;
        }

        const expiresAt = data.Expired
            ? new Date(data.Expired).toISOString()
            : new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60 * 1000).toISOString();
        const result = execute(
            `INSERT INTO playback_orders
               (product_id, buyer_name, buyer_phone, device_hash, request_ip, gateway, gateway_ref, reference, amount, status, qris_payload, expires_at, order_kind, renew_token_id, recovery_code)
             VALUES (?, ?, ?, ?, ?, 'ipaymu', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
            [
                product.id,
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
                orderKind,
                renewTokenId,
                generateRecoveryCode(),
            ]
        );
        return this.getOrder(result.lastInsertRowid);
    }

    getOrder(id) {
        const order = queryOne('SELECT * FROM playback_orders WHERE id = ?', [id]);
        if (!order) {
            throw notFound('Order tidak ditemukan');
        }
        this._expireIfDue(order);
        // Crash-recovery: paid but never minted (process died mid-issue) gets its token now.
        if (order.status === 'paid' && !order.token_id) {
            this._ensureFulfilled(order.id);
        }
        return this._present(queryOne('SELECT * FROM playback_orders WHERE id = ?', [id]));
    }

    /**
     * Poll entry point for the buy page. An order is visible ONLY to the device that created it, so
     * one buyer can never read another's order — or their access credential.
     */
    async getOwnedOrderStatus(id, deviceHash) {
        const raw = queryOne('SELECT id, device_hash FROM playback_orders WHERE id = ?', [id]);
        if (!raw || !deviceHash || raw.device_hash !== deviceHash) {
            throw notFound('Order tidak ditemukan');
        }
        await this.syncOrder(id);
        return this.getOrder(id);
    }

    /** Re-check a pending order against iPaymu with a signed request. Safe to call repeatedly. */
    async syncOrder(orderId) {
        const order = queryOne('SELECT * FROM playback_orders WHERE id = ?', [orderId]);
        if (!order || order.gateway !== 'ipaymu' || order.status !== 'pending') {
            return order;
        }
        const updatedAtMs = order.updated_at
            ? new Date(`${String(order.updated_at).replace(' ', 'T')}Z`).getTime()
            : 0;
        if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < RECHECK_THROTTLE_MS) {
            return order;
        }
        // Stamp FIRST so concurrent polls don't stampede the gateway.
        execute('UPDATE playback_orders SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [order.id]);

        try {
            const { body } = await ipaymuRequest('/api/v2/transaction', {
                transactionId: Number(order.gateway_ref) || order.gateway_ref,
            });
            const status = interpretIpaymuTransaction(body?.Data || body?.data);
            if (status.paid) {
                if (status.amount !== null && status.amount < order.amount) {
                    console.error(`[PlaybackOrder] amount mismatch order ${order.id}: ${status.amount} < ${order.amount}`);
                    return queryOne('SELECT * FROM playback_orders WHERE id = ?', [order.id]);
                }
                this._confirmOrder(order);
            } else if (status.expired) {
                execute(
                    "UPDATE playback_orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
                    [order.id]
                );
            }
        } catch (error) {
            console.error('[PlaybackOrder] iPaymu status check failed:', error.message);
        }
        return queryOne('SELECT * FROM playback_orders WHERE id = ?', [order.id]);
    }

    /**
     * iPaymu notify handler. The body is untrusted, so it only tells us WHICH order to re-verify
     * against the API — it never decides that money arrived.
     */
    async handleWebhook(body) {
        const trxId = body?.trx_id ?? body?.transaction_id ?? body?.trxId ?? null;
        const referenceId = body?.reference_id ?? body?.referenceId ?? null;

        let order = null;
        if (trxId) {
            order = queryOne("SELECT * FROM playback_orders WHERE gateway = 'ipaymu' AND gateway_ref = ?", [String(trxId)]);
        }
        if (!order && referenceId) {
            order = queryOne("SELECT * FROM playback_orders WHERE gateway = 'ipaymu' AND reference = ?", [String(referenceId)]);
        }
        if (!order) {
            return { handled: false, reason: 'unknown_transaction' };
        }
        if (order.status !== 'pending') {
            return { handled: true, status: order.status };
        }
        // Force an immediate re-check regardless of the poll throttle.
        execute("UPDATE playback_orders SET updated_at = datetime('now', '-1 minute') WHERE id = ?", [order.id]);
        const synced = await this.syncOrder(order.id);
        return { handled: true, status: synced?.status || 'pending' };
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    _confirmOrder(order) {
        // Guarded flip — only ONE caller moves pending→paid, and only that caller mints.
        const flip = execute(
            "UPDATE playback_orders SET status = 'paid', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
            [order.id]
        );
        if (flip.changes === 0) {
            // Lost the race (double webhook / racing poll): the winner mints. A paid row left without
            // a token by a crash is healed by _ensureTokenIssued on the next getOrder.
            return queryOne('SELECT * FROM playback_orders WHERE id = ?', [order.id]);
        }
        this._ensureFulfilled(order.id);
        return queryOne('SELECT * FROM playback_orders WHERE id = ?', [order.id]);
    }

    /**
     * Idempotent fulfilment of a PAID order that still has no token: MINT (purchase) or EXTEND
     * (renewal) exactly once. Crash-safe — getOrder re-runs it while token_id is NULL.
     */
    _ensureFulfilled(orderId) {
        const order = queryOne('SELECT * FROM playback_orders WHERE id = ?', [orderId]);
        if (!order || order.status !== 'paid' || order.token_id) {
            return;
        }
        const product = playbackProductService.getById(order.product_id);
        if (!product) {
            console.error(`[PlaybackOrder] order ${orderId} references a missing product ${order.product_id}`);
            return;
        }

        if (order.order_kind === 'renewal') {
            if (!order.renew_token_id) {
                console.error(`[PlaybackOrder] renewal order ${orderId} has no renew_token_id`);
                return;
            }
            // Extend exactly once (renewToken is idempotent on order_id via its ledger), THEN claim the
            // order so a crash between the two heals cleanly (renewToken sees the ledger and no-ops).
            try {
                playbackTokenRenewalService.renewToken(order.renew_token_id, product.validity_days, { orderId: order.id });
            } catch (error) {
                console.error(`[PlaybackOrder] renewal of token ${order.renew_token_id} for order ${orderId} failed:`, error.message);
                return;
            }
            execute('UPDATE playback_orders SET token_id = ? WHERE id = ? AND token_id IS NULL', [order.renew_token_id, orderId]);
            return;
        }
        const issued = playbackProductService.issueTokenForProduct(product, {
            label: `${product.label} — ${order.buyer_name || 'pembeli'}`,
            note: `order ${order.id} device ${String(order.device_hash).slice(0, 12)}`,
        });
        // createToken returns { token, data, share_key, share_text } — the row id is on `data`, not at
        // the root. Claiming with issued.id would write NULL, so the guard below would never see the
        // slot as taken and every poll would mint another token for the same payment.
        const issuedId = issued?.data?.id;
        if (!issuedId) {
            console.error(`[PlaybackOrder] order ${orderId}: token minted without an id, refusing to claim`);
            return;
        }
        // Claim the slot; if a concurrent caller already set token_id, revoke our orphan and stop —
        // leaving it live would mean one payment bought two working tokens.
        const claim = execute('UPDATE playback_orders SET token_id = ? WHERE id = ? AND token_id IS NULL', [issuedId, orderId]);
        if (claim.changes === 0) {
            try {
                playbackTokenService.revokeToken(issuedId);
            } catch (error) {
                console.error(`[PlaybackOrder] failed to revoke orphan token ${issuedId}:`, error.message);
            }
        }
    }

    _expireIfDue(order) {
        if (order.status !== 'pending' || !order.expires_at) return;
        if (new Date(order.expires_at).getTime() > Date.now()) return;
        execute(
            "UPDATE playback_orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
            [order.id]
        );
    }

    /**
     * Presented shape. The access credential is attached ONLY once the order is paid, and callers
     * reach this exclusively through getOwnedOrderStatus, which has already proven device ownership.
     */
    _present(order) {
        if (!order) return null;
        let payment = null;
        try {
            payment = order.qris_payload ? JSON.parse(order.qris_payload) : null;
        } catch {
            payment = null;
        }
        const product = playbackProductService.getById(order.product_id);

        let access = null;
        if (order.status === 'paid' && order.token_id) {
            const token = queryOne(
                'SELECT share_key_prefix, expires_at, playback_window_hours FROM playback_tokens WHERE id = ?',
                [order.token_id]
            );
            if (token) {
                access = {
                    shareKey: token.share_key_prefix,
                    expiresAt: token.expires_at,
                    windowHours: token.playback_window_hours,
                };
            }
        }

        return {
            id: order.id,
            status: order.status,
            amount: order.amount,
            expiresAt: order.expires_at,
            paidAt: order.paid_at,
            orderKind: order.order_kind || 'purchase',
            recoveryCode: order.recovery_code || null,
            renewTokenId: order.renew_token_id || null,
            product: product
                ? { key: product.key, label: product.label, windowHours: product.window_hours, validityDays: product.validity_days }
                : null,
            payment,
            access,
        };
    }

    /**
     * Anonymous recovery: given the buyer's phone + the recovery code shown at purchase, return their
     * still-valid tokens. No messaging needed — the buyer types what they saved. The route rate-limits
     * this; matching requires BOTH fields so a code alone (or a phone alone) reveals nothing.
     */
    recoverActiveTokens(phone, recoveryCode) {
        const ph = (phone || '').toString().trim();
        const code = (recoveryCode || '').toString().trim().toUpperCase();
        if (!ph || !code) throw badRequest('Nomor HP dan kode pemulihan wajib diisi');

        const orders = query(
            `SELECT id, token_id, product_id, order_kind, created_at, paid_at
             FROM playback_orders
             WHERE buyer_phone = ? AND recovery_code = ? AND status = 'paid' AND token_id IS NOT NULL
             ORDER BY id DESC`,
            [ph, code]
        );
        const out = [];
        for (const o of orders) {
            const token = queryOne(
                'SELECT id, share_key_prefix, expires_at, revoked_at, playback_window_hours FROM playback_tokens WHERE id = ?',
                [o.token_id]
            );
            if (!token || token.revoked_at) continue;
            const product = playbackProductService.getById(o.product_id);
            out.push({
                orderId: o.id,
                orderKind: o.order_kind || 'purchase',
                shareKey: token.share_key_prefix,
                expiresAt: token.expires_at,
                windowHours: token.playback_window_hours,
                product: product ? { key: product.key, label: product.label } : null,
                paidAt: o.paid_at,
            });
        }
        return out;
    }
}

export default new PlaybackOrderService();
