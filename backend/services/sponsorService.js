/*
Purpose: Manage local sponsor records, package assignments, and camera-sponsor links.
Caller: sponsorController (admin CRUD) and public sponsor endpoints (active list, cameras).
Deps: connectionPool (shared DB pool used by the rest of the backend).
MainFuncs: getAllSponsors, getActiveSponsors, getSponsorById, createSponsor, updateSponsor, deleteSponsor, assignSponsorToCamera, removeSponsorFromCamera, getCamerasWithSponsors, getSponsorStats, getExpiringSponsorships, countCamerasPerSponsor.
SideEffects: Reads/writes the sponsors table and sponsor_* columns on cameras.
*/

import { query, queryOne, execute } from '../database/connectionPool.js';

// Display order is now driven by sponsor_packages.sort_order (admin-editable
// in the catalog). The LEFT JOIN keeps legacy/orphan sponsor rows visible —
// e.g. a sponsor whose package key no longer matches any catalog entry —
// they just sort to the end of the list instead of disappearing.
const SPONSOR_SELECT_WITH_PACKAGE = `
    SELECT s.*,
        sp.name AS package_name,
        sp.color AS package_color,
        sp.sort_order AS package_sort_order,
        sp.default_camera_limit AS package_default_camera_limit
    FROM sponsors s
    LEFT JOIN sponsor_packages sp ON sp.key = s.package
`;

const PACKAGE_ORDER_SQL = `
    COALESCE(sp.sort_order, 9999),
    s.created_at DESC
`;

/**
 * Get all sponsors
 */
export function getAllSponsors() {
    return query(`${SPONSOR_SELECT_WITH_PACKAGE} ORDER BY ${PACKAGE_ORDER_SQL}`);
}

/**
 * Get active sponsors only
 */
export function getActiveSponsors() {
    return query(`
        ${SPONSOR_SELECT_WITH_PACKAGE}
        WHERE s.active = 1
        AND (s.end_date IS NULL OR s.end_date >= DATE('now'))
        ORDER BY ${PACKAGE_ORDER_SQL}
    `);
}

/**
 * Get sponsor by ID
 */
export function getSponsorById(id) {
    const sponsors = query(`${SPONSOR_SELECT_WITH_PACKAGE} WHERE s.id = ?`, [id]);
    return sponsors.length > 0 ? sponsors[0] : null;
}

/**
 * Create new sponsor
 */
export function createSponsor(sponsorData) {
    const {
        name,
        logo,
        url,
        package: pkg,
        price,
        camera_limit,
        active = 1,
        start_date,
        end_date,
        contact_name,
        contact_email,
        contact_phone,
        notes
    } = sponsorData;

    // camera_limit: null/'' = unlimited (the Gold default). The schema
    // validator already enforces integer >= 0 or null; this just normalises
    // empty-string from older clients.
    const normalizedCameraLimit = camera_limit === null || camera_limit === undefined || camera_limit === ''
        ? null
        : Number(camera_limit);

    return execute(`
        INSERT INTO sponsors (
            name, logo, url, package, price, camera_limit, active,
            start_date, end_date, contact_name, contact_email,
            contact_phone, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        name, logo, url, pkg, price, normalizedCameraLimit, active,
        start_date, end_date, contact_name, contact_email,
        contact_phone, notes
    ]);
}

/**
 * Update sponsor
 */
export function updateSponsor(id, sponsorData) {
    const {
        name,
        logo,
        url,
        package: pkg,
        price,
        active,
        start_date,
        end_date,
        contact_name,
        contact_email,
        contact_phone,
        notes
    } = sponsorData;

    const updates = [];
    const values = [];

    if (name !== undefined) {
        updates.push('name = ?');
        values.push(name);
    }
    if (logo !== undefined) {
        updates.push('logo = ?');
        values.push(logo);
    }
    if (url !== undefined) {
        updates.push('url = ?');
        values.push(url);
    }
    if (pkg !== undefined) {
        updates.push('package = ?');
        values.push(pkg);
    }
    if (price !== undefined) {
        updates.push('price = ?');
        values.push(price);
    }
    if (Object.prototype.hasOwnProperty.call(sponsorData, 'camera_limit')) {
        // Per-sponsor camera cap. null = unlimited; same normalisation as create.
        updates.push('camera_limit = ?');
        values.push(
            sponsorData.camera_limit === null || sponsorData.camera_limit === ''
                ? null
                : Number(sponsorData.camera_limit)
        );
    }
    if (active !== undefined) {
        updates.push('active = ?');
        values.push(active);
    }
    if (start_date !== undefined) {
        updates.push('start_date = ?');
        values.push(start_date);
    }
    if (end_date !== undefined) {
        updates.push('end_date = ?');
        values.push(end_date);
    }
    if (contact_name !== undefined) {
        updates.push('contact_name = ?');
        values.push(contact_name);
    }
    if (contact_email !== undefined) {
        updates.push('contact_email = ?');
        values.push(contact_email);
    }
    if (contact_phone !== undefined) {
        updates.push('contact_phone = ?');
        values.push(contact_phone);
    }
    if (notes !== undefined) {
        updates.push('notes = ?');
        values.push(notes);
    }

    if (updates.length === 0) {
        throw new Error('No fields to update');
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    return execute(
        `UPDATE sponsors SET ${updates.join(', ')} WHERE id = ?`,
        values
    );
}

/**
 * Delete sponsor
 */
export function deleteSponsor(id) {
    return execute('DELETE FROM sponsors WHERE id = ?', [id]);
}

/**
 * Get cameras by sponsor package
 */
export function getCamerasByPackage(pkg) {
    return query(`
        SELECT * FROM cameras 
        WHERE sponsor_package = ? 
        AND enabled = 1
        ORDER BY id ASC
    `, [pkg]);
}

/**
 * Get sponsor statistics
 */
export function getSponsorStats() {
    const stats = query(`
        SELECT 
            COUNT(*) as total_sponsors,
            SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_sponsors,
            SUM(CASE WHEN package = 'bronze' THEN 1 ELSE 0 END) as bronze_count,
            SUM(CASE WHEN package = 'silver' THEN 1 ELSE 0 END) as silver_count,
            SUM(CASE WHEN package = 'gold' THEN 1 ELSE 0 END) as gold_count,
            SUM(CASE WHEN active = 1 THEN price ELSE 0 END) as monthly_revenue
        FROM sponsors
    `);

    return stats[0];
}

/**
 * Get expiring sponsors (within 7 days)
 */
export function getExpiringSponsorships() {
    return query(`
        SELECT * FROM sponsors
        WHERE active = 1
        AND end_date IS NOT NULL
        AND end_date BETWEEN DATE('now') AND DATE('now', '+7 days')
        ORDER BY end_date ASC
    `);
}

/**
 * Assign sponsor to a single camera. Enforces the sponsor's `camera_limit`
 * if set (null = unlimited). Throws 409 with a clear message when adding
 * this camera would put the sponsor over its own cap, so admins see exactly
 * why the click was rejected instead of getting a silent overwrite.
 *
 * The camera being assigned is excluded from the cap check — re-applying
 * the same sponsor to a camera it already covers must always succeed
 * (idempotent), and so must swapping the sponsor on a camera (the slot is
 * being freed and reused).
 */
export function assignSponsorToCamera(cameraId, sponsorData) {
    const { sponsor_name, sponsor_logo, sponsor_url, sponsor_package } = sponsorData;

    if (sponsor_name) {
        const sponsorRow = queryOne(
            'SELECT id, camera_limit FROM sponsors WHERE name = ?',
            [sponsor_name]
        );
        if (sponsorRow && sponsorRow.camera_limit !== null && sponsorRow.camera_limit !== undefined) {
            const limit = Number(sponsorRow.camera_limit);
            const currentRow = queryOne(
                `SELECT COUNT(*) AS n FROM cameras
                 WHERE sponsor_name = ? AND id != ?`,
                [sponsor_name, cameraId]
            );
            const occupiedExcludingThis = Number(currentRow?.n || 0);
            if (occupiedExcludingThis + 1 > limit) {
                const err = new Error(
                    `Sponsor "${sponsor_name}" sudah mencapai batas ${limit} kamera. ` +
                    `Naikkan camera_limit-nya atau lepas kamera lain dulu.`
                );
                err.statusCode = 409;
                throw err;
            }
        }
    }

    return execute(`
        UPDATE cameras
        SET sponsor_name = ?,
            sponsor_logo = ?,
            sponsor_url = ?,
            sponsor_package = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [sponsor_name, sponsor_logo, sponsor_url, sponsor_package, cameraId]);
}

/**
 * Remove sponsor from camera
 */
export function removeSponsorFromCamera(cameraId) {
    return execute(`
        UPDATE cameras 
        SET sponsor_name = NULL,
            sponsor_logo = NULL,
            sponsor_url = NULL,
            sponsor_package = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [cameraId]);
}

/**
 * Get cameras with sponsors
 */
export function getCamerasWithSponsors() {
    return query(`
        SELECT * FROM cameras
        WHERE sponsor_name IS NOT NULL
        AND enabled = 1
        ORDER BY
            CASE sponsor_package
                WHEN 'gold' THEN 1
                WHEN 'silver' THEN 2
                WHEN 'bronze' THEN 3
                ELSE 4
            END,
            id ASC
    `);
}

/**
 * Count cameras currently linked to each sponsor (matched by sponsor name
 * because cameras carry denormalized sponsor_* columns). Returns a map
 * { [sponsorName]: cameraCount } that the controller folds into the
 * sponsor list response so the admin sees coverage at a glance.
 */
export function countCamerasPerSponsor() {
    const rows = query(`
        SELECT sponsor_name AS name, COUNT(*) AS camera_count
        FROM cameras
        WHERE sponsor_name IS NOT NULL AND enabled = 1
        GROUP BY sponsor_name
    `);
    const counts = {};
    for (const row of rows) {
        if (row?.name) {
            counts[row.name] = row.camera_count;
        }
    }
    return counts;
}

export default {
    getAllSponsors,
    getActiveSponsors,
    getSponsorById,
    createSponsor,
    updateSponsor,
    deleteSponsor,
    getCamerasByPackage,
    getSponsorStats,
    getExpiringSponsorships,
    assignSponsorToCamera,
    removeSponsorFromCamera,
    getCamerasWithSponsors,
    countCamerasPerSponsor,
};
