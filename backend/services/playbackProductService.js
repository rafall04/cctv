/**
 * Purpose: Catalogue of public playback-access products, and the single place that turns a bought
 *          or claimed product into an actual playback token.
 * Caller: playbackTrialService, playbackOrderService, playbackAccessController (public list),
 *         playbackProductController (admin list/create/edit).
 * Deps: connectionPool, playbackTokenService.
 * MainFuncs: listPublic, listAll, getByKey, getById, createProduct, updateProduct, issueTokenForProduct.
 * SideEffects: Reads/writes playback_products; issueTokenForProduct writes playback_tokens.
 *
 * The two axes are deliberately independent and must stay that way:
 *   window_hours   how far BACK a buyer may look
 *   validity_days  how long they keep looking
 * Collapsing them is the obvious simplification and it is wrong: the trial sells 1 hour of depth for
 * 3 days precisely because 1 hour sits inside the 4-hour local recording retention, so a trial never
 * pulls a file back from Telegram however many people claim one.
 *
 * Prices are INTEGER rupiah. Never float — see the money rule in AGENTS.md.
 */

import { query, queryOne, execute } from '../database/connectionPool.js';
import playbackTokenService from './playbackTokenService.js';

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    err.expose = true;
    return err;
}

/** Keys are looked up by other code (`getByKey('trial')`), so they must stay URL/word safe. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * The commercial fields, validated identically for create and update.
 *
 * The price rule is not cosmetic. playbackOrderService refuses any non-trial product priced at 0
 * ("Paket ini gratis — pakai tombol coba gratis"), so a free paid package would render a "Beli"
 * button that can never succeed. And a priced TRIAL is the opposite contradiction: the trial path
 * never charges, so the number would be displayed and then ignored. Both are rejected here, where
 * an operator can still see why, rather than becoming a dead end on the public page.
 */
function validateCommercials({ price, windowHours, validityDays, isTrial }) {
    if (!Number.isInteger(price) || price < 0) throw badRequest('Harga harus bilangan bulat rupiah, minimal 0');
    if (isTrial && price !== 0) throw badRequest('Paket coba gratis harus berharga 0');
    if (!isTrial && price < 1) throw badRequest('Paket berbayar harus punya harga di atas 0 — kalau ingin gratis, pakai paket coba gratis');
    if (!Number.isInteger(windowHours) || windowHours < 1) throw badRequest('Kedalaman lihat-ke-belakang minimal 1 jam');
    if (!Number.isInteger(validityDays) || validityDays < 1) throw badRequest('Masa berlaku minimal 1 hari');
}

/** Public shape: never leaks internal ids or flags the buyer has no use for. */
function presentPublic(row) {
    return {
        key: row.key,
        label: row.label,
        description: row.description || '',
        price: row.price_rupiah,
        windowHours: row.window_hours,
        validityDays: row.validity_days,
        isTrial: !!row.is_trial,
    };
}

class PlaybackProductService {
    listPublic() {
        return query(
            'SELECT * FROM playback_products WHERE enabled = 1 ORDER BY sort_order ASC, id ASC'
        ).map(presentPublic);
    }

    listAll() {
        return query('SELECT * FROM playback_products ORDER BY sort_order ASC, id ASC');
    }

    getByKey(key) {
        return queryOne('SELECT * FROM playback_products WHERE key = ?', [String(key || '')]);
    }

    getById(id) {
        return queryOne('SELECT * FROM playback_products WHERE id = ?', [id]);
    }

    /**
     * Add a paid package. Always `is_trial = 0`: the free trial is found by the literal key 'trial'
     * and its "once per device" guarantee is a PRIMARY KEY on playback_trial_claims, so a second
     * trial-flagged row would not get a second guarantee — it would just be a package the trial flow
     * never reaches. One trial exists, seeded by migration; everything added here is sold.
     */
    createProduct(payload = {}) {
        const key = String(payload.key || '').trim().toLowerCase();
        if (!KEY_PATTERN.test(key)) {
            throw badRequest('Kode paket hanya boleh huruf kecil, angka, - dan _ (2-32 karakter)');
        }
        if (this.getByKey(key)) {
            throw badRequest(`Kode paket "${key}" sudah dipakai`);
        }

        const label = String(payload.label || '').trim();
        if (!label) throw badRequest('Nama paket wajib diisi');

        const price = payload.price_rupiah;
        const windowHours = payload.window_hours;
        const validityDays = payload.validity_days;
        validateCommercials({ price, windowHours, validityDays, isTrial: false });

        // Plain INSERT so a duplicate key FAILS loudly. The uniqueness check above can race, and the
        // replace-on-conflict variant would silently DELETE the existing package — and the price an
        // operator set on it — instead of erroring. See the data-safety rules in AGENTS.md.
        const result = execute(
            `INSERT INTO playback_products
                (key, label, description, price_rupiah, window_hours, validity_days, is_trial, enabled, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [
                key,
                label,
                payload.description ?? '',
                price,
                windowHours,
                validityDays,
                payload.enabled === undefined ? 1 : (payload.enabled ? 1 : 0),
                Number.isInteger(payload.sort_order) ? payload.sort_order : 99,
            ]
        );
        return this.getById(result.lastInsertRowid);
    }

    /**
     * Admin edit. Only the commercial fields move — `key` and `is_trial` are structural: other code
     * looks the trial up BY KEY, so letting an operator rename or re-flag it would silently detach
     * the trial flow from its product.
     */
    updateProduct(id, payload = {}) {
        const existing = this.getById(id);
        if (!existing) {
            const err = new Error('Paket tidak ditemukan');
            err.statusCode = 404;
            throw err;
        }
        const price = payload.price_rupiah ?? existing.price_rupiah;
        const windowHours = payload.window_hours ?? existing.window_hours;
        const validityDays = payload.validity_days ?? existing.validity_days;

        validateCommercials({ price, windowHours, validityDays, isTrial: !!existing.is_trial });

        execute(
            `UPDATE playback_products
                SET label = ?, description = ?, price_rupiah = ?, window_hours = ?, validity_days = ?,
                    enabled = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [
                String(payload.label ?? existing.label).trim() || existing.label,
                payload.description ?? existing.description,
                price,
                windowHours,
                validityDays,
                payload.enabled === undefined ? existing.enabled : (payload.enabled ? 1 : 0),
                payload.sort_order ?? existing.sort_order,
                id,
            ]
        );
        return this.getById(id);
    }

    /**
     * Turn a product into a live playback token covering every community camera.
     *
     * scope_type 'all' is what keeps this honest as the fleet grows: a camera added to Bojonegoro
     * tomorrow is covered by tokens sold today, with no backfill step that someone would forget.
     * Non-community cameras are excluded by cameraAccessService on every read regardless of scope,
     * so 'all' can never widen into owner_private or subscriber footage.
     */
    issueTokenForProduct(product, { label = null, note = null } = {}) {
        if (!product) throw badRequest('Paket tidak ditemukan');

        const expiresAt = new Date(Date.now() + product.validity_days * 24 * 60 * 60 * 1000);
        return playbackTokenService.createToken({
            preset: 'custom',
            label: label || `${product.label} — publik`,
            scope_type: 'all',
            playback_window_hours: product.window_hours,
            expires_at: expiresAt.toISOString(),
            client_note: note || null,
        });
    }
}

export default new PlaybackProductService();
