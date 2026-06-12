/**
 * Purpose: Per-customer private areas ("Area Saya") — owner-scoped CRUD + ownership
 *          resolution for camera assignment. A SEPARATE namespace from the public `areas`
 *          table: every read here is filtered by owner_user_id, and public surfaces never
 *          touch this table, so a customer's grouping can't leak onto a public surface.
 * Caller: customerController (area endpoints), customerCameraService (assign/validate).
 * Deps: connectionPool.
 * MainFuncs: listOwnAreas, createOwnArea, deleteOwnArea, resolveOwnAreaId, assertOwnedArea.
 * SideEffects: Writes customer_areas; nulls cameras.customer_area_id on area delete.
 */

import { query, queryOne, execute } from '../database/connectionPool.js';

const MAX_AREAS_PER_CUSTOMER = 50;
const MAX_NAME_LENGTH = 40;

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

class CustomerAreaService {
    listOwnAreas(userId) {
        return query(
            `SELECT ca.id, ca.name, ca.created_at,
                    (SELECT COUNT(*) FROM cameras c
                      WHERE c.customer_area_id = ca.id AND c.owner_user_id = ca.owner_user_id) AS camera_count
             FROM customer_areas ca
             WHERE ca.owner_user_id = ?
             ORDER BY ca.name COLLATE NOCASE ASC`,
            [userId]
        );
    }

    _normalizeName(name) {
        const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
        if (clean.length < 1 || clean.length > MAX_NAME_LENGTH) {
            throw badRequest(`Nama area 1-${MAX_NAME_LENGTH} karakter`);
        }
        return clean;
    }

    createOwnArea(userId, name) {
        const clean = this._normalizeName(name);

        const count = queryOne('SELECT COUNT(*) AS n FROM customer_areas WHERE owner_user_id = ?', [userId]).n;
        if (count >= MAX_AREAS_PER_CUSTOMER) {
            throw badRequest(`Maksimal ${MAX_AREAS_PER_CUSTOMER} area per akun`);
        }
        // Case-insensitive duplicate guard (the UNIQUE index is case-sensitive).
        const existing = queryOne(
            'SELECT id FROM customer_areas WHERE owner_user_id = ? AND name = ? COLLATE NOCASE',
            [userId, clean]
        );
        if (existing) {
            throw badRequest('Area dengan nama itu sudah ada');
        }

        const result = execute(
            'INSERT INTO customer_areas (owner_user_id, name) VALUES (?, ?)',
            [userId, clean]
        );
        return queryOne(
            `SELECT id, name, created_at, 0 AS camera_count FROM customer_areas WHERE id = ?`,
            [result.lastInsertRowid]
        );
    }

    deleteOwnArea(userId, areaId) {
        const area = this.assertOwnedArea(userId, areaId);
        // Unlink this owner's cameras first (scoped so we never touch another tenant's
        // rows; FK cascade only fires when SQLite's foreign_keys pragma is on).
        execute(
            'UPDATE cameras SET customer_area_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE customer_area_id = ? AND owner_user_id = ?',
            [area.id, userId]
        );
        execute('DELETE FROM customer_areas WHERE id = ? AND owner_user_id = ?', [area.id, userId]);
        return { id: area.id, name: area.name };
    }

    /**
     * Resolve a customer-supplied area id to the caller's OWN area id, or null when the
     * input is empty/null (clears the link). Throws 400 if the id is non-empty but not
     * owned by the user — blocking "attach my camera to another tenant's area" by id guess.
     */
    resolveOwnAreaId(userId, areaId) {
        if (areaId === undefined || areaId === null || areaId === '') {
            return null;
        }
        const id = Number(areaId);
        if (!Number.isInteger(id) || id <= 0) {
            throw badRequest('Area tidak valid');
        }
        return this.assertOwnedArea(userId, id).id;
    }

    assertOwnedArea(userId, areaId) {
        const area = queryOne(
            'SELECT id, name, owner_user_id FROM customer_areas WHERE id = ?',
            [areaId]
        );
        if (!area || Number(area.owner_user_id) !== Number(userId)) {
            throw badRequest('Area tidak ditemukan atau bukan milik Anda');
        }
        return area;
    }
}

export default new CustomerAreaService();
