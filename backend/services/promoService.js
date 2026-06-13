/**
 * Purpose: Promo codes — wallet top-up bonuses (percent/flat, credited when a top-up is
 *          confirmed) and instant gift credit. Enforces expiry, total quota (max_uses), and
 *          per-account limit; records every redemption for audit + limit counting.
 * Caller: customerController (validate/redeem), paymentService (applyTopupBonus on confirm),
 *         billingAdminController (CRUD).
 * Deps: connectionPool, walletService, securityAuditLogger.
 * MainFuncs: validateForTopup, computeBonus, redeemGift, applyTopupBonus, listPromos,
 *            createPromo, updatePromo, deletePromo.
 * SideEffects: Writes promo_codes / promo_redemptions / wallets via walletService.
 *
 * Limit enforcement: validateForTopup is a SOFT pre-check at top-up creation (UX preview);
 * the HARD cap is applyTopupBonus/redeemGift, which re-check inside a transaction before
 * crediting — so creating many pending top-ups with one code can never over-issue the bonus.
 */

import { query, queryOne, execute, transaction } from '../database/connectionPool.js';
import walletService from './walletService.js';
import { logAdminAction } from './securityAuditLogger.js';

export const PROMO_TYPES = ['percent', 'flat', 'gift'];

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

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase();
}

class PromoService {
    _findActiveByCode(code) {
        const clean = normalizeCode(code);
        if (!clean) return null;
        return queryOne('SELECT * FROM promo_codes WHERE code = ? AND active = 1', [clean]);
    }

    /** Bonus rupiah for a top-up of `amount` under this promo (percent capped by max_bonus). */
    computeBonus(promo, amount) {
        if (promo.type === 'percent') {
            const raw = Math.floor((amount * promo.value) / 100);
            return promo.max_bonus ? Math.min(raw, promo.max_bonus) : raw;
        }
        if (promo.type === 'flat') {
            return promo.value;
        }
        return 0; // gift is not a top-up bonus
    }

    /** Re-checked inside the redeem transaction: expiry, total quota, per-account limit. */
    _assertRedeemable(promo, userId) {
        if (!promo.active) {
            throw badRequest('Kode promo tidak aktif');
        }
        if (promo.expires_at && new Date(promo.expires_at).getTime() < Date.now()) {
            throw badRequest('Kode promo sudah kedaluwarsa');
        }
        const fresh = queryOne('SELECT used_count FROM promo_codes WHERE id = ?', [promo.id]);
        if (promo.max_uses != null && fresh && fresh.used_count >= promo.max_uses) {
            throw badRequest('Kuota kode promo sudah habis');
        }
        const mine = queryOne(
            'SELECT COUNT(*) AS n FROM promo_redemptions WHERE promo_id = ? AND user_id = ?',
            [promo.id, userId]
        ).n;
        if (mine >= promo.per_user_limit) {
            throw badRequest('Anda sudah memakai kode promo ini');
        }
    }

    /**
     * Soft validation when a customer enters a code on the top-up form. Returns the bonus
     * that WOULD be granted (credited on confirmation). Throws 400 with a clear reason.
     */
    validateForTopup(code, userId, amount) {
        const promo = this._findActiveByCode(code);
        if (!promo) {
            throw badRequest('Kode promo tidak valid');
        }
        if (promo.type === 'gift') {
            throw badRequest('Kode ini hadiah saldo — pakai lewat "Tukar Kode", bukan saat top-up');
        }
        this._assertRedeemable(promo, userId);
        // Unpaid top-ups already carrying this code reserve a slot of the per-user limit:
        // without this, the same code could preview "+bonus" on several pending top-ups when
        // only one would ever credit (applyTopupBonus caps it). Count redemptions + pending.
        const reserved = queryOne(
            "SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND promo_code = ? AND status = 'pending'",
            [userId, promo.code]
        ).n;
        const used = queryOne(
            'SELECT COUNT(*) AS n FROM promo_redemptions WHERE promo_id = ? AND user_id = ?',
            [promo.id, userId]
        ).n;
        if (used + reserved >= promo.per_user_limit) {
            throw badRequest('Kode ini sudah dipakai pada top-up Anda yang belum dibayar — selesaikan dulu pembayaran itu');
        }
        if (amount < (promo.min_topup || 0)) {
            throw badRequest(`Kode ini butuh top-up minimal Rp${Number(promo.min_topup).toLocaleString('id-ID')}`);
        }
        const bonus = this.computeBonus(promo, amount);
        return { code: promo.code, type: promo.type, bonus };
    }

    /** Gift code → instant wallet credit. Atomic: re-checks limits, credits, records, counts. */
    redeemGift(code, userId, request = null) {
        const promo = this._findActiveByCode(code);
        if (!promo) {
            throw badRequest('Kode promo tidak valid');
        }
        if (promo.type !== 'gift') {
            throw badRequest('Kode ini bonus top-up — pakai saat mengisi saldo, bukan tukar kode');
        }
        const run = transaction(() => {
            this._assertRedeemable(promo, userId);
            const bonus = promo.value;
            walletService.credit({
                userId,
                amount: bonus,
                type: 'adjustment',
                reference: `promo-gift:${promo.id}:${userId}`,
                note: `Hadiah promo ${promo.code}`,
            });
            execute(
                'INSERT INTO promo_redemptions (promo_id, user_id, payment_id, bonus_amount) VALUES (?, ?, NULL, ?)',
                [promo.id, userId, bonus]
            );
            execute('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?', [promo.id]);
            return bonus;
        });
        const bonus = run();
        if (request) {
            logAdminAction({ action: 'promo_gift_redeemed', promoCode: promo.code, userId, bonus }, request);
        }
        return { code: promo.code, bonus, balance: walletService.getBalance(userId) };
    }

    /**
     * Credit a confirmed top-up's promo bonus exactly once. Re-checks the cap (so stacking
     * pending top-ups can't over-issue) and is idempotent on payment_id. Called from
     * paymentService._confirmPayment after the top-up amount is credited.
     */
    applyTopupBonus(payment) {
        if (!payment || !payment.promo_code || !payment.promo_bonus || payment.promo_bonus <= 0) {
            return null;
        }
        // Idempotency: a bonus for this payment was already granted.
        if (queryOne('SELECT id FROM promo_redemptions WHERE payment_id = ?', [payment.id])) {
            return null;
        }
        const promo = this._findActiveByCode(payment.promo_code);
        if (!promo || promo.type === 'gift') {
            return null;
        }
        try {
            const run = transaction(() => {
                this._assertRedeemable(promo, payment.user_id);
                walletService.credit({
                    userId: payment.user_id,
                    amount: payment.promo_bonus,
                    type: 'adjustment',
                    reference: `promo-topup:${payment.id}`,
                    note: `Bonus promo ${payment.promo_code}`,
                });
                execute(
                    'INSERT INTO promo_redemptions (promo_id, user_id, payment_id, bonus_amount) VALUES (?, ?, ?, ?)',
                    [promo.id, payment.user_id, payment.id, payment.promo_bonus]
                );
                execute('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?', [promo.id]);
                return payment.promo_bonus;
            });
            return run();
        } catch (error) {
            console.error(`[Promo] top-up bonus skipped for payment ${payment.id}: ${error.message}`);
            return null;
        }
    }

    // ------------------------------------------------------------------
    // Admin CRUD
    // ------------------------------------------------------------------

    listPromos() {
        return query(`
            SELECT p.*, (SELECT COUNT(*) FROM promo_redemptions r WHERE r.promo_id = p.id) AS redeemed_count
            FROM promo_codes p
            ORDER BY p.active DESC, p.id DESC
        `);
    }

    _normalizePayload(data, { partial = false } = {}) {
        const out = {};
        const has = (k) => data[k] !== undefined;

        if (has('type') || !partial) {
            if (!PROMO_TYPES.includes(data.type)) {
                throw badRequest('Tipe promo harus percent, flat, atau gift');
            }
            out.type = data.type;
        }
        if (has('value') || !partial) {
            const value = Number(data.value);
            if (!Number.isInteger(value) || value <= 0) {
                throw badRequest('Nilai promo harus bilangan bulat > 0');
            }
            const type = out.type || data.type;
            if (type === 'percent' && value > 100) {
                throw badRequest('Promo persen maksimal 100');
            }
            out.value = value;
        }
        if (has('max_bonus')) {
            out.max_bonus = data.max_bonus === null || data.max_bonus === '' ? null : Math.max(0, parseInt(data.max_bonus, 10) || 0);
        }
        if (has('min_topup')) {
            out.min_topup = Math.max(0, parseInt(data.min_topup, 10) || 0);
        }
        if (has('max_uses')) {
            out.max_uses = data.max_uses === null || data.max_uses === '' ? null : Math.max(1, parseInt(data.max_uses, 10) || 1);
        }
        if (has('per_user_limit')) {
            out.per_user_limit = Math.max(1, parseInt(data.per_user_limit, 10) || 1);
        }
        if (has('active')) {
            out.active = data.active === false || data.active === 0 ? 0 : 1;
        }
        if (has('expires_at')) {
            out.expires_at = data.expires_at ? String(data.expires_at) : null;
        }
        if (has('description')) {
            out.description = data.description ? String(data.description).slice(0, 200) : null;
        }
        return out;
    }

    createPromo(data, request = null) {
        const code = normalizeCode(data.code);
        if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
            throw badRequest('Kode 3-30 karakter (huruf/angka/-/_)');
        }
        if (queryOne('SELECT id FROM promo_codes WHERE code = ?', [code])) {
            throw badRequest('Kode promo sudah ada');
        }
        const payload = this._normalizePayload(data);
        const result = execute(
            `INSERT INTO promo_codes (code, type, value, max_bonus, min_topup, max_uses, per_user_limit, active, expires_at, description)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                code, payload.type, payload.value,
                payload.max_bonus ?? null, payload.min_topup ?? 0,
                payload.max_uses ?? null, payload.per_user_limit ?? 1,
                payload.active ?? 1, payload.expires_at ?? null, payload.description ?? null,
            ]
        );
        if (request) {
            logAdminAction({ action: 'promo_created', code, type: payload.type, value: payload.value }, request);
        }
        return queryOne('SELECT * FROM promo_codes WHERE id = ?', [result.lastInsertRowid]);
    }

    updatePromo(id, data, request = null) {
        const promo = queryOne('SELECT * FROM promo_codes WHERE id = ?', [id]);
        if (!promo) {
            throw notFound('Promo tidak ditemukan');
        }
        const payload = this._normalizePayload(data, { partial: true });
        const updates = [];
        const values = [];
        for (const [col, val] of Object.entries(payload)) {
            updates.push(`${col} = ?`);
            values.push(val);
        }
        if (updates.length === 0) {
            throw badRequest('Tidak ada field yang diubah');
        }
        values.push(id);
        execute(`UPDATE promo_codes SET ${updates.join(', ')} WHERE id = ?`, values);
        if (request) {
            logAdminAction({ action: 'promo_updated', promoId: Number(id), changes: payload }, request);
        }
        return queryOne('SELECT * FROM promo_codes WHERE id = ?', [id]);
    }

    deletePromo(id, request = null) {
        const promo = queryOne('SELECT * FROM promo_codes WHERE id = ?', [id]);
        if (!promo) {
            throw notFound('Promo tidak ditemukan');
        }
        execute('DELETE FROM promo_codes WHERE id = ?', [id]); // redemptions kept for audit
        if (request) {
            logAdminAction({ action: 'promo_deleted', promoId: Number(id), code: promo.code }, request);
        }
        return { id: Number(id), code: promo.code };
    }
}

export default new PromoService();
