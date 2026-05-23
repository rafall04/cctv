/*
Purpose: Admin-editable sponsor package catalog — keys, defaults, display ordering.
Caller: sponsorPackageController, sponsorService (JOIN for sponsor enrichment).
Deps: connectionPool.
MainFuncs: getAllPackages, getPackageByKey, createPackage, updatePackage, deletePackage, countSponsorsByKey.
SideEffects: Reads/writes the sponsor_packages table.

Note: features_json is stored as a JSON-encoded TEXT in SQLite. The service
is the single point that parses/stringifies it so callers always receive
arrays. Callers must not stringify themselves.
*/

import { query, queryOne, execute } from '../database/connectionPool.js';

function parseFeatures(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry || '')).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function hydrate(row) {
    if (!row) return null;
    return {
        id: row.id,
        key: row.key,
        name: row.name,
        color: row.color,
        default_price: row.default_price,
        default_camera_limit: row.default_camera_limit, // null = unlimited
        features: parseFeatures(row.features_json),
        sort_order: row.sort_order,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

export function getAllPackages() {
    const rows = query(
        'SELECT * FROM sponsor_packages ORDER BY sort_order ASC, name ASC'
    );
    return rows.map(hydrate);
}

export function getPackageByKey(key) {
    const row = queryOne('SELECT * FROM sponsor_packages WHERE key = ?', [key]);
    return hydrate(row);
}

export function getPackageById(id) {
    const row = queryOne('SELECT * FROM sponsor_packages WHERE id = ?', [id]);
    return hydrate(row);
}

/**
 * Count sponsors per package key. Used so the admin UI can show how many
 * sponsors currently reference each package profile — and prevent deletion
 * of a profile that is still in use.
 */
export function countSponsorsByKey() {
    const rows = query(`
        SELECT package AS key, COUNT(*) AS sponsor_count
        FROM sponsors
        WHERE package IS NOT NULL
        GROUP BY package
    `);
    const map = {};
    for (const row of rows) {
        if (row.key) map[row.key] = row.sponsor_count;
    }
    return map;
}

export function createPackage({ key, name, color, default_price, default_camera_limit, features, sort_order }) {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey) {
        const err = new Error('Package key wajib diisi');
        err.statusCode = 400;
        throw err;
    }
    if (!/^[a-z0-9_-]{1,40}$/.test(normalizedKey)) {
        const err = new Error('Package key hanya boleh huruf kecil, angka, underscore, atau strip (maks 40 karakter)');
        err.statusCode = 400;
        throw err;
    }

    const existing = getPackageByKey(normalizedKey);
    if (existing) {
        const err = new Error(`Package key '${normalizedKey}' sudah dipakai`);
        err.statusCode = 409;
        throw err;
    }

    const result = execute(
        `INSERT INTO sponsor_packages
            (key, name, color, default_price, default_camera_limit, features_json, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            normalizedKey,
            String(name || normalizedKey).trim(),
            String(color || 'gray').trim() || 'gray',
            Number.isFinite(Number(default_price)) ? Number(default_price) : 0,
            default_camera_limit === null || default_camera_limit === undefined || default_camera_limit === ''
                ? null
                : Math.max(0, Math.floor(Number(default_camera_limit))),
            JSON.stringify(Array.isArray(features) ? features.map((f) => String(f || '').trim()).filter(Boolean) : []),
            Number.isFinite(Number(sort_order)) ? Number(sort_order) : 100,
        ]
    );
    return getPackageById(result.lastInsertRowid);
}

export function updatePackage(id, payload = {}) {
    const existing = getPackageById(id);
    if (!existing) {
        const err = new Error('Package tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }

    // `key` is intentionally NOT editable post-creation. Sponsors carry the
    // key as a denormalized column on cameras (sponsor_package), so renaming
    // would silently break the public-facing badge color/label mapping.
    const updates = [];
    const values = [];
    if (payload.name !== undefined) { updates.push('name = ?'); values.push(String(payload.name).trim() || existing.name); }
    if (payload.color !== undefined) { updates.push('color = ?'); values.push(String(payload.color).trim() || existing.color); }
    if (payload.default_price !== undefined) {
        updates.push('default_price = ?');
        values.push(Number.isFinite(Number(payload.default_price)) ? Number(payload.default_price) : existing.default_price);
    }
    if (payload.default_camera_limit !== undefined) {
        updates.push('default_camera_limit = ?');
        values.push(
            payload.default_camera_limit === null || payload.default_camera_limit === ''
                ? null
                : Math.max(0, Math.floor(Number(payload.default_camera_limit)))
        );
    }
    if (payload.features !== undefined) {
        const features = Array.isArray(payload.features)
            ? payload.features.map((f) => String(f || '').trim()).filter(Boolean)
            : [];
        updates.push('features_json = ?');
        values.push(JSON.stringify(features));
    }
    if (payload.sort_order !== undefined) {
        updates.push('sort_order = ?');
        values.push(Number.isFinite(Number(payload.sort_order)) ? Number(payload.sort_order) : existing.sort_order);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    execute(`UPDATE sponsor_packages SET ${updates.join(', ')} WHERE id = ?`, values);
    return getPackageById(id);
}

export function deletePackage(id) {
    const pkg = getPackageById(id);
    if (!pkg) {
        const err = new Error('Package tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }

    const counts = countSponsorsByKey();
    const inUse = counts[pkg.key] || 0;
    if (inUse > 0) {
        const err = new Error(`Package '${pkg.name}' masih dipakai ${inUse} sponsor — pindahkan dulu`);
        err.statusCode = 409;
        throw err;
    }

    execute('DELETE FROM sponsor_packages WHERE id = ?', [id]);
    return { id, key: pkg.key };
}

export default {
    getAllPackages,
    getPackageByKey,
    getPackageById,
    countSponsorsByKey,
    createPackage,
    updatePackage,
    deletePackage,
};
