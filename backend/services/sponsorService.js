/**
 * Sponsor Service
 * Mengelola sponsor dan sponsorship packages
 */

import { query, execute } from '../database/database.js';

/**
 * Get all sponsors
 */
export function getAllSponsors() {
    return query('SELECT * FROM sponsors ORDER BY created_at DESC');
}

/**
 * Get active sponsors only
 */
export function getActiveSponsors() {
    return query(`
        SELECT * FROM sponsors 
        WHERE active = 1 
        AND (end_date IS NULL OR end_date >= DATE('now'))
        ORDER BY package DESC, created_at DESC
    `);
}

/**
 * Get sponsor by ID
 */
export function getSponsorById(id) {
    const sponsors = query('SELECT * FROM sponsors WHERE id = ?', [id]);
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
        active = 1,
        start_date,
        end_date,
        contact_name,
        contact_email,
        contact_phone,
        notes
    } = sponsorData;

    return execute(`
        INSERT INTO sponsors (
            name, logo, url, package, price, active,
            start_date, end_date, contact_name, contact_email,
            contact_phone, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        name, logo, url, pkg, price, active,
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
 * Assign sponsor to camera
 */
export function assignSponsorToCamera(cameraId, sponsorData) {
    const { sponsor_name, sponsor_logo, sponsor_url, sponsor_package } = sponsorData;
    
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
        ORDER BY sponsor_package DESC, id ASC
    `);
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
    getCamerasWithSponsors
};
