/**
 * Purpose: Voucher-gated area access (Phase 1 — domain logic, no payment/gate wiring yet).
 *          Profil voucher (template à la Mikrotik) + kode voucher berdurasi + redeem per-perangkat,
 *          plus the global feature flag and the per-area "berbayar" marker. All of this is INERT
 *          until an admin both enables the flag AND marks areas gated — the gate itself (canViewLive)
 *          is wired in Phase 2.
 * Caller: (Phase 2+) cameraAccessService gate, billing admin routes, public redeem route.
 * Deps: connectionPool (settings/areas/voucher_* tables), securityAuditLogger, node:crypto.
 * MainFuncs: isFeatureEnabled/setFeatureEnabled, isAreaGated/setAreaGated/listGatedAreaIds,
 *            listProfiles/createProfile/updateProfile/deleteProfile,
 *            generateCodes/redeemCode/revokeCode/listCodes,
 *            getAccessibleAreaIds/hasAreaAccess, expireDue.
 * SideEffects: Writes voucher_* + settings + areas.is_access_gated rows.
 *
 * Access model: a profil bundles areas (voucher_profile_areas) and defines durasi (duration_minutes,
 * default 1 hari) + maks pemakai per kode (max_uses_per_code, default 1 = ketat). A kode activates
 * on first redeem (expires_at = now + durasi); each distinct device is one redemption row (UNIQUE on
 * code_id+device_hash) and is bounded by max_uses_per_code. Access is granted strictly on PROOF OF
 * POSSESSION: getAccessibleAreaIds keys on the device's redemption rows — the phone (buyer_phone) is
 * stored for contact/struk ONLY and is never an access credential (it is unverified + guessable).
 * Portability across devices is by RE-ENTERING THE CODE on the new device (a new redemption, still
 * bounded by max_uses_per_code), not by typing a phone number. "Stacking" (bisa add) is realised by
 * holding several active codes: getAccessibleAreaIds unions every area covered by a still-valid code,
 * so buying another code adds coverage/time. Money is INTEGER rupiah.
 */

import crypto from 'crypto';
import { query, queryOne, execute, transaction } from '../database/connectionPool.js';
import { logAdminAction } from './securityAuditLogger.js';

export const FEATURE_KEY = 'voucher_access_enabled';

// Human-friendly code alphabet — no 0/O/1/I to avoid read-aloud / hand-write mistakes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_DURATION_MINUTES = 1440; // 1 hari
const MAX_DURATION_MINUTES = 525600;   // 1 tahun
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
    return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizePhone(phone) {
    if (phone === null || phone === undefined) return null;
    let clean = String(phone).replace(/[\s-]/g, '');
    if (!clean) return null;
    // Canonicalize Indonesian prefixes to one leading-0 form (same as billingPlanService's
    // accepted /^(\+62|62|0)8.../ inputs) so the same human number stored/searched as +62 / 62 / 0
    // is one consistent value. (Phone is contact-only — not used for access — but consistency matters
    // for admin lookups, the COALESCE-on-redeem, and any future per-buyer query.)
    clean = clean.replace(/^\+62/, '0').replace(/^62/, '0');
    return clean || null;
}

function toMinutes(value, unit) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) {
        throw badRequest('Durasi harus angka > 0');
    }
    const factor = unit === 'jam' ? 60 : (unit === 'menit' ? 1 : 1440); // default 'hari'
    const minutes = v * factor;
    // Reject fractional minutes explicitly instead of silently rounding (a "0.6 menit" must not
    // quietly become 1, nor "0.4 menit" become 0-then-rejected).
    if (!Number.isInteger(minutes)) {
        throw badRequest('Durasi harus menghasilkan jumlah menit bulat');
    }
    return minutes;
}

function normalizeAreaIds(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set();
    for (const item of raw) {
        const id = Number(item);
        if (Number.isInteger(id) && id > 0) {
            seen.add(id);
        }
    }
    return [...seen];
}

function randomVoucherCode() {
    const len = 8;
    const bytes = crypto.randomBytes(len);
    let s = '';
    for (let i = 0; i < len; i++) {
        s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function normalizeProfilePayload(data, { partial = false } = {}) {
    const out = {};
    const has = (k) => data[k] !== undefined;

    if (has('name') || !partial) {
        if (!data.name || String(data.name).trim().length < 2) {
            throw badRequest('Nama profil minimal 2 karakter');
        }
        out.name = String(data.name).trim();
    }
    if (has('description')) {
        out.description = data.description ? String(data.description).trim() : null;
    }

    // Duration accepts canonical minutes OR a value+unit pair (menit/jam/hari).
    if (has('duration_minutes') || has('duration_value') || !partial) {
        let minutes;
        if (has('duration_minutes')) {
            minutes = Number(data.duration_minutes);
        } else if (has('duration_value')) {
            minutes = toMinutes(data.duration_value, data.duration_unit);
        } else {
            minutes = DEFAULT_DURATION_MINUTES;
        }
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_DURATION_MINUTES) {
            throw badRequest('Durasi harus antara 1 menit dan 1 tahun');
        }
        out.duration_minutes = minutes;
    }

    if (has('max_uses_per_code') || !partial) {
        const m = Number(data.max_uses_per_code ?? 1);
        if (!Number.isInteger(m) || m < 1 || m > 1000) {
            throw badRequest('Maks pemakai per kode harus 1-1000');
        }
        out.max_uses_per_code = m;
    }

    if (has('price') || !partial) {
        const p = Number(data.price ?? 0);
        if (!Number.isInteger(p) || p < 0) {
            throw badRequest('Harga harus bilangan bulat >= 0 (rupiah)');
        }
        out.price = p;
    }

    if (has('code_validity_days')) {
        if (data.code_validity_days === null || data.code_validity_days === '') {
            out.code_validity_days = null;
        } else {
            const d = Number(data.code_validity_days);
            if (!Number.isInteger(d) || d < 1 || d > 3650) {
                throw badRequest('Masa berlaku kode harus 1-3650 hari');
            }
            out.code_validity_days = d;
        }
    }

    if (has('online_purchasable') || !partial) {
        out.online_purchasable = (data.online_purchasable === false || data.online_purchasable === 0 || data.online_purchasable === '0') ? 0 : 1;
    }
    if (has('active') || !partial) {
        out.active = (data.active === false || data.active === 0 || data.active === '0') ? 0 : 1;
    }
    if (has('sort_order')) {
        const s = Number(data.sort_order);
        out.sort_order = Number.isInteger(s) ? s : 100;
    } else if (!partial) {
        out.sort_order = 100;
    }

    if (has('area_ids')) {
        out.area_ids = normalizeAreaIds(data.area_ids);
    } else if (!partial) {
        out.area_ids = [];
    }

    return out;
}

class VoucherService {
    // ------------------------------------------------------------------
    // Global feature flag (default OFF — a missing settings row reads false)
    // ------------------------------------------------------------------

    isFeatureEnabled() {
        try {
            const row = queryOne('SELECT value FROM settings WHERE key = ?', [FEATURE_KEY]);
            return !!row && (row.value === 'true' || row.value === '1' || row.value === 1);
        } catch {
            return false;
        }
    }

    setFeatureEnabled(enabled, request = null) {
        const on = enabled === true || enabled === 'true' || enabled === 1 || enabled === '1';
        execute(
            `INSERT INTO settings (key, value, description) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
            [FEATURE_KEY, on ? 'true' : 'false', 'Aktifkan pembatasan akses CCTV via voucher per-area']
        );
        if (request) {
            logAdminAction({ action: 'voucher_feature_toggled', enabled: on }, request);
        }
        return { enabled: on };
    }

    // ------------------------------------------------------------------
    // Per-area "berbayar" marker (explicit opt-in — never auto-gated)
    // ------------------------------------------------------------------

    isAreaGated(areaId) {
        const row = queryOne('SELECT is_access_gated FROM areas WHERE id = ?', [areaId]);
        return !!row && (row.is_access_gated === 1 || row.is_access_gated === true);
    }

    setAreaGated(areaId, gated, request = null) {
        const area = queryOne('SELECT id FROM areas WHERE id = ?', [areaId]);
        if (!area) {
            throw notFound('Area tidak ditemukan');
        }
        const value = (gated === true || gated === 1 || gated === '1') ? 1 : 0;
        execute('UPDATE areas SET is_access_gated = ? WHERE id = ?', [value, areaId]);
        if (request) {
            logAdminAction({ action: 'voucher_area_gated_set', areaId: Number(areaId), gated: value === 1 }, request);
        }
        return { area_id: Number(areaId), is_access_gated: value };
    }

    listGatedAreaIds() {
        return query('SELECT id FROM areas WHERE is_access_gated = 1 ORDER BY id').map((r) => r.id);
    }

    // ------------------------------------------------------------------
    // Profiles (template)
    // ------------------------------------------------------------------

    _getProfileAreaIds(profileId) {
        return query(
            'SELECT area_id FROM voucher_profile_areas WHERE profile_id = ? ORDER BY area_id',
            [profileId]
        ).map((r) => r.area_id);
    }

    _withAreas(profile) {
        if (!profile) return null;
        return { ...profile, area_ids: this._getProfileAreaIds(profile.id) };
    }

    _assertAreasExist(areaIds) {
        for (const areaId of areaIds) {
            if (!queryOne('SELECT id FROM areas WHERE id = ?', [areaId])) {
                throw badRequest(`Area #${areaId} tidak ditemukan`);
            }
        }
    }

    _setAreas(profileId, areaIds) {
        execute('DELETE FROM voucher_profile_areas WHERE profile_id = ?', [profileId]);
        for (const areaId of areaIds) {
            execute(
                'INSERT OR IGNORE INTO voucher_profile_areas (profile_id, area_id) VALUES (?, ?)',
                [profileId, areaId]
            );
        }
    }

    listProfiles({ activeOnly = false } = {}) {
        const rows = query(
            `SELECT * FROM voucher_profiles ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order ASC, id ASC`
        );
        return rows.map((p) => this._withAreas(p));
    }

    getProfileById(id) {
        return this._withAreas(queryOne('SELECT * FROM voucher_profiles WHERE id = ?', [id]));
    }

    createProfile(data, request = null) {
        const payload = normalizeProfilePayload(data);
        this._assertAreasExist(payload.area_ids);

        const result = execute(
            `INSERT INTO voucher_profiles
               (name, description, duration_minutes, max_uses_per_code, price, code_validity_days, online_purchasable, active, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.name,
                payload.description ?? null,
                payload.duration_minutes,
                payload.max_uses_per_code,
                payload.price,
                payload.code_validity_days ?? null,
                payload.online_purchasable,
                payload.active,
                payload.sort_order,
            ]
        );
        const id = result.lastInsertRowid;
        this._setAreas(id, payload.area_ids);

        if (request) {
            logAdminAction({ action: 'voucher_profile_created', profileId: Number(id), name: payload.name }, request);
        }
        return this.getProfileById(id);
    }

    updateProfile(id, data, request = null) {
        const existing = queryOne('SELECT * FROM voucher_profiles WHERE id = ?', [id]);
        if (!existing) {
            throw notFound('Profil voucher tidak ditemukan');
        }
        const payload = normalizeProfilePayload(data, { partial: true });
        if (payload.area_ids !== undefined) {
            this._assertAreasExist(payload.area_ids);
        }

        const columns = ['name', 'description', 'duration_minutes', 'max_uses_per_code', 'price', 'code_validity_days', 'online_purchasable', 'active', 'sort_order'];
        const updates = [];
        const values = [];
        for (const col of columns) {
            if (payload[col] !== undefined) {
                updates.push(`${col} = ?`);
                values.push(payload[col]);
            }
        }
        if (updates.length > 0) {
            values.push(id);
            execute(`UPDATE voucher_profiles SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
        }
        if (payload.area_ids !== undefined) {
            this._setAreas(id, payload.area_ids);
        }
        if (updates.length === 0 && payload.area_ids === undefined) {
            throw badRequest('Tidak ada field yang diubah');
        }

        if (request) {
            logAdminAction({ action: 'voucher_profile_updated', profileId: Number(id), changes: Object.keys(payload) }, request);
        }
        return this.getProfileById(id);
    }

    deleteProfile(id, request = null) {
        const existing = queryOne('SELECT id FROM voucher_profiles WHERE id = ?', [id]);
        if (!existing) {
            throw notFound('Profil voucher tidak ditemukan');
        }
        const codeCount = queryOne('SELECT COUNT(*) AS n FROM voucher_codes WHERE profile_id = ?', [id]).n;
        if (codeCount > 0) {
            throw badRequest(`Tidak bisa hapus profil — sudah ada ${codeCount} kode voucher. Nonaktifkan saja (active = 0).`);
        }
        execute('DELETE FROM voucher_profile_areas WHERE profile_id = ?', [id]);
        execute('DELETE FROM voucher_profiles WHERE id = ?', [id]);
        if (request) {
            logAdminAction({ action: 'voucher_profile_deleted', profileId: Number(id) }, request);
        }
        return { id: Number(id) };
    }

    // ------------------------------------------------------------------
    // Codes
    // ------------------------------------------------------------------

    _uniqueCode() {
        for (let attempt = 0; attempt < 12; attempt++) {
            const code = randomVoucherCode();
            if (!queryOne('SELECT id FROM voucher_codes WHERE code = ?', [code])) {
                return code;
            }
        }
        throw new Error('Gagal membuat kode voucher unik');
    }

    /**
     * Generate one or more unused codes for a profile. `source` is 'admin' (komplimen, default)
     * or 'self' (paid self-serve, Phase 3). Optionally pre-bind a buyer (admin issuing to a known
     * person). code_expires_at (masa hangus) is snapshotted from the profile at generation time.
     */
    generateCodes(profileId, count = 1, { source = 'admin', buyer_name = null, buyer_phone = null, createdBy = null } = {}, request = null) {
        const profile = queryOne('SELECT * FROM voucher_profiles WHERE id = ?', [profileId]);
        if (!profile) {
            throw notFound('Profil voucher tidak ditemukan');
        }
        const n = Number(count);
        if (!Number.isInteger(n) || n < 1 || n > 500) {
            throw badRequest('Jumlah kode harus 1-500');
        }
        const normalizedSource = source === 'self' ? 'self' : 'admin';
        const phone = normalizePhone(buyer_phone);
        const codeExpiresAt = profile.code_validity_days
            ? new Date(Date.now() + profile.code_validity_days * ONE_DAY_MS).toISOString()
            : null;

        const created = [];
        for (let i = 0; i < n; i++) {
            const code = this._uniqueCode();
            const result = execute(
                `INSERT INTO voucher_codes
                   (code, profile_id, status, source, buyer_name, buyer_phone, code_expires_at, order_ref, created_by)
                 VALUES (?, ?, 'unused', ?, ?, ?, ?, NULL, ?)`,
                [code, profileId, normalizedSource, buyer_name || null, phone, codeExpiresAt, createdBy ?? null]
            );
            created.push(queryOne('SELECT * FROM voucher_codes WHERE id = ?', [result.lastInsertRowid]));
        }

        if (request) {
            logAdminAction({ action: 'voucher_codes_generated', profileId: Number(profileId), count: n, source: normalizedSource }, request);
        }
        return created;
    }

    getCodeByCode(code) {
        return queryOne('SELECT * FROM voucher_codes WHERE code = ?', [normalizeCode(code)]);
    }

    listCodes({ profileId = null, status = null, limit = 100 } = {}) {
        const where = [];
        const params = [];
        if (profileId) {
            where.push('profile_id = ?');
            params.push(profileId);
        }
        if (status) {
            where.push('status = ?');
            params.push(status);
        }
        const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
        params.push(lim);
        return query(
            `SELECT * FROM voucher_codes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
            params
        );
    }

    /**
     * Redeem a code from a specific device. First redeem activates the code (expires_at = now +
     * durasi). Each distinct device is one redemption row, capped by the profile's
     * max_uses_per_code; the same device re-redeeming is idempotent (no extra slot). Returns the
     * area_ids this code now unlocks so the caller can issue/refresh the access pass (Phase 2).
     */
    redeemCode(code, { name = null, phone = null, deviceHash = null } = {}) {
        if (!deviceHash || typeof deviceHash !== 'string') {
            throw badRequest('deviceHash wajib diisi');
        }
        const clean = normalizeCode(code);
        if (!clean) {
            throw badRequest('Kode voucher tidak valid');
        }
        const row = queryOne('SELECT * FROM voucher_codes WHERE code = ?', [clean]);
        if (!row) {
            throw badRequest('Kode voucher tidak valid');
        }
        if (row.status === 'revoked') {
            throw badRequest('Kode voucher sudah dicabut');
        }
        const profile = this.getProfileById(row.profile_id);
        if (!profile || !profile.active) {
            throw badRequest('Paket voucher tidak aktif');
        }

        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        const cleanPhone = normalizePhone(phone);
        const cleanName = name ? String(name).trim() : null;

        // Masa hangus (kode tak pernah diaktifkan) — mark + reject.
        if (row.status === 'unused' && row.code_expires_at && row.code_expires_at <= nowIso) {
            execute("UPDATE voucher_codes SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'unused'", [row.id]);
            throw badRequest('Kode voucher sudah kedaluwarsa (tidak pernah diaktifkan)');
        }
        // Masa aktif habis.
        if (row.status === 'expired' || (row.status === 'active' && row.expires_at && row.expires_at <= nowIso)) {
            execute("UPDATE voucher_codes SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'", [row.id]);
            throw badRequest('Masa aktif kode voucher sudah berakhir');
        }

        // The cap re-check below reads via the pooled READ connection (query/queryOne), which under
        // WAL sees committed state only. Correct under the current single-writer deployment
        // (PM2 instances:1 + synchronous better-sqlite3 → redeems serialize, no interleave), and
        // UNIQUE(code_id, device_hash) hard-backstops same-device double counting. If this is ever
        // run multi-process/clustered, move the count check onto the write connection (Phase-3 note).
        const run = transaction(() => {
            const fresh = queryOne('SELECT * FROM voucher_codes WHERE id = ?', [row.id]);
            const existing = queryOne(
                'SELECT id FROM voucher_redemptions WHERE code_id = ? AND device_hash = ?',
                [fresh.id, deviceHash]
            );

            if (!existing) {
                const used = queryOne('SELECT COUNT(*) AS n FROM voucher_redemptions WHERE code_id = ?', [fresh.id]).n;
                if (used >= profile.max_uses_per_code) {
                    throw badRequest('Kuota perangkat untuk kode ini sudah penuh');
                }
                execute(
                    'INSERT INTO voucher_redemptions (code_id, device_hash, buyer_name, buyer_phone) VALUES (?, ?, ?, ?)',
                    [fresh.id, deviceHash, cleanName || fresh.buyer_name || null, cleanPhone || fresh.buyer_phone || null]
                );
            }

            let activatedAt = fresh.activated_at;
            let expiresAt = fresh.expires_at;
            let status = fresh.status;

            if (fresh.status === 'unused') {
                activatedAt = nowIso;
                expiresAt = new Date(nowMs + profile.duration_minutes * 60 * 1000).toISOString();
                status = 'active';
                execute(
                    `UPDATE voucher_codes
                       SET status = 'active', activated_at = ?, expires_at = ?,
                           buyer_name = COALESCE(buyer_name, ?), buyer_phone = COALESCE(buyer_phone, ?),
                           redeemed_count = (SELECT COUNT(*) FROM voucher_redemptions WHERE code_id = ?),
                           updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [activatedAt, expiresAt, cleanName, cleanPhone, fresh.id, fresh.id]
                );
            } else {
                execute(
                    `UPDATE voucher_codes
                       SET redeemed_count = (SELECT COUNT(*) FROM voucher_redemptions WHERE code_id = ?),
                           updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [fresh.id, fresh.id]
                );
            }
            return { activatedAt, expiresAt, status };
        });
        const result = run();

        return {
            code: clean,
            status: result.status,
            activated_at: result.activatedAt,
            expires_at: result.expiresAt,
            area_ids: profile.area_ids,
            profile: { id: profile.id, name: profile.name },
        };
    }

    revokeCode(codeId, request = null) {
        const row = queryOne('SELECT id, status FROM voucher_codes WHERE id = ?', [codeId]);
        if (!row) {
            throw notFound('Kode voucher tidak ditemukan');
        }
        execute("UPDATE voucher_codes SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [codeId]);
        if (request) {
            logAdminAction({ action: 'voucher_code_revoked', codeId: Number(codeId) }, request);
        }
        return { id: Number(codeId), status: 'revoked' };
    }

    // ------------------------------------------------------------------
    // Access queries (consumed by the Phase 2 gate)
    // ------------------------------------------------------------------

    /**
     * Area ids currently unlocked for a device. Keyed STRICTLY on the device's own redemption rows
     * (proof of possession of the code) — the phone is contact-only and is deliberately NOT an access
     * path (it is unverified + low-entropy/guessable; treating it as a credential would let anyone who
     * knows the number in, bypassing the code AND max_uses_per_code). A buyer who switches device
     * regains access by RE-ENTERING THE CODE on it. Fail-closed: a code must be 'active' with a
     * non-null, future expires_at, so a lapsed-but-unswept (or anomalous NULL-expiry) code never
     * grants access.
     */
    getAccessibleAreaIds({ deviceHash = null } = {}) {
        if (!deviceHash) {
            return [];
        }
        const nowIso = new Date().toISOString();
        const rows = query(
            `SELECT DISTINCT pa.area_id
             FROM voucher_redemptions r
             JOIN voucher_codes c ON c.id = r.code_id
             JOIN voucher_profile_areas pa ON pa.profile_id = c.profile_id
             WHERE r.device_hash = ? AND c.status = 'active'
               AND c.expires_at IS NOT NULL AND c.expires_at > ?`,
            [deviceHash, nowIso]
        );
        return [...new Set(rows.map((r) => r.area_id))];
    }

    hasAreaAccess(areaId, { deviceHash = null } = {}) {
        return this.getAccessibleAreaIds({ deviceHash }).includes(Number(areaId));
    }

    // ------------------------------------------------------------------
    // Housekeeping
    // ------------------------------------------------------------------

    /** Sweep lapsed codes to 'expired' (active past expires_at; unused past code_expires_at). */
    expireDue() {
        const nowIso = new Date().toISOString();
        const a = execute(
            "UPDATE voucher_codes SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?",
            [nowIso]
        );
        const b = execute(
            "UPDATE voucher_codes SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'unused' AND code_expires_at IS NOT NULL AND code_expires_at <= ?",
            [nowIso]
        );
        return { expired: (a.changes || 0) + (b.changes || 0) };
    }
}

export default new VoucherService();
