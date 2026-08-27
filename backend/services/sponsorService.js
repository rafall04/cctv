/*
Purpose: Manage local sponsor records, package assignments, and camera-sponsor links.
Caller: sponsorController (admin CRUD) and public sponsor endpoints (active list, cameras).
Deps: connectionPool (shared DB pool used by the rest of the backend).
MainFuncs: getAllSponsors, getActiveSponsors, getSponsorById, createSponsor, updateSponsor, deleteSponsor, assignSponsorToCamera, removeSponsorFromCamera, getCamerasWithSponsors, getSponsorStats, getExpiringSponsorships, countCamerasPerSponsor.
SideEffects: Reads/writes the sponsors table and sponsor_* columns on cameras.
*/

import { query, queryOne, execute, transaction } from '../database/connectionPool.js';

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

/*
 * PUBLIC projection. `SPONSOR_SELECT_WITH_PACKAGE` above is `SELECT s.*`, which is right for the
 * admin list and wrong for anonymous visitors: the sponsors table also holds `price` (the
 * sponsorship rate we charged), `contact_name`, `contact_email`, `contact_phone` (a third party's
 * PII) and `notes` (free-form internal remarks).
 *
 * The codebase already knew those five columns were sensitive — sponsorRoutes.js gates the admin
 * list behind requireAdmin with a comment naming price, contact_email and contact_phone as things
 * 'a viewer-role user must not see'. And two lines later it registered the PUBLIC route running
 * the same star-select, publishing to the whole internet what the gate withheld from a logged-in
 * viewer. Sharing one SELECT constant between an admin reader and a public one is what made that
 * possible, so the public path gets its own.
 *
 * The columns are exactly what the landing SponsorStrip renders. Anything more has to be added
 * here deliberately, which is the point.
 */
const PUBLIC_SPONSOR_SELECT = `
    SELECT s.id, s.name, s.logo, s.url, s.package,
        sp.name AS package_name,
        sp.color AS package_color,
        sp.sort_order AS package_sort_order
    FROM sponsors s
    LEFT JOIN sponsor_packages sp ON sp.key = s.package
`;

/**
 * Get all sponsors
 */
export function getAllSponsors() {
    return query(`${SPONSOR_SELECT_WITH_PACKAGE} ORDER BY ${PACKAGE_ORDER_SQL}`);
}

/**
 * Sponsors currently on display. This feeds an UNAUTHENTICATED route (GET /api/sponsors/active,
 * called by the landing SponsorStrip on every visit), so it reads through PUBLIC_SPONSOR_SELECT
 * and never the admin star-select. See the WHY on that constant.
 */
export function getActiveSponsors() {
    return query(`
        ${PUBLIC_SPONSOR_SELECT}
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

    /*
     * Kamera membawa SALINAN nama/logo/url/paket sponsornya, dan salinan itu yang dirender
     * di permukaan publik. Tanpa penyegaran di sini, sponsor yang mengganti logonya akan
     * melihat logo lamanya terus tayang di setiap kameranya - dan tidak ada satu pun galat
     * yang memberi tahu siapa pun.
     *
     * Hanya keempat kolom tampilan yang disegarkan, dan hanya yang benar-benar dikirim
     * pemanggil: `undefined` berarti "tidak disentuh", bukan "kosongkan".
     */
    const tampilan = [];
    const nilaiTampilan = [];
    if (name !== undefined) { tampilan.push('sponsor_name = ?'); nilaiTampilan.push(name); }
    if (logo !== undefined) { tampilan.push('sponsor_logo = ?'); nilaiTampilan.push(logo); }
    if (url !== undefined) { tampilan.push('sponsor_url = ?'); nilaiTampilan.push(url); }
    if (pkg !== undefined) { tampilan.push('sponsor_package = ?'); nilaiTampilan.push(pkg); }

    return transaction(() => {
        const hasil = execute(
            `UPDATE sponsors SET ${updates.join(', ')} WHERE id = ?`,
            values
        );
        if (tampilan.length > 0) {
            execute(
                `UPDATE cameras SET ${tampilan.join(', ')}, updated_at = CURRENT_TIMESTAMP
                 WHERE sponsor_id = ?`,
                [...nilaiTampilan, id]
            );
        }
        return hasil;
    });
}

/**
 * Hapus sponsor, DAN lepaskan tiap kamera yang membawanya, dalam satu transaksi.
 *
 * Tanpa pembersihan itu kamera menyimpan nama, logo, dan URL sponsor yang sudah tidak ada -
 * dan tetap MENAMPILKANNYA di permukaan publik. Sponsor yang kontraknya habis lalu dihapus
 * akan terus diiklankan gratis sampai ada yang kebetulan menyadarinya.
 */
export function deleteSponsor(id) {
    return transaction(() => {
        execute(`
            UPDATE cameras
            SET sponsor_id = NULL,
                sponsor_name = NULL,
                sponsor_logo = NULL,
                sponsor_url = NULL,
                sponsor_package = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE sponsor_id = ?
        `, [id]);
        return execute('DELETE FROM sponsors WHERE id = ?', [id]);
    });
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
    const { sponsor_id, sponsor_name, sponsor_logo, sponsor_url, sponsor_package } = sponsorData;

    /*
     * Baris sponsor dicari lewat KUNCI kalau pemanggil memberikannya, dan lewat nama hanya
     * sebagai jalan mundur untuk pemanggil lama. Nama yang cocok dengan lebih dari satu baris
     * DITOLAK, bukan ditebak: menebak akan menaruh kamera pada sponsor yang keliru dan memakai
     * jatah batas kamera milik orang lain.
     */
    let sponsorRow = null;
    if (sponsor_id) {
        sponsorRow = queryOne('SELECT id, camera_limit FROM sponsors WHERE id = ?', [sponsor_id]);
        if (!sponsorRow) {
            const err = new Error('Sponsor tidak ditemukan');
            err.statusCode = 404;
            throw err;
        }
    } else if (sponsor_name) {
        const cocok = query('SELECT id, camera_limit FROM sponsors WHERE name = ?', [sponsor_name]);
        if (cocok.length > 1) {
            const err = new Error(
                `Ada ${cocok.length} sponsor bernama "${sponsor_name}". Pilih sponsornya lewat id.`
            );
            err.statusCode = 409;
            throw err;
        }
        sponsorRow = cocok[0] || null;
    }

    if (sponsorRow) {
        if (sponsorRow.camera_limit !== null && sponsorRow.camera_limit !== undefined) {
            const limit = Number(sponsorRow.camera_limit);
            /*
             * Dihitung lewat sponsor_id. Dulu lewat sponsor_name, sehingga sponsor yang baru
             * berganti nama membaca hitungan NOL dan batasnya berhenti berlaku sepenuhnya.
             */
            const currentRow = queryOne(
                `SELECT COUNT(*) AS n FROM cameras
                 WHERE sponsor_id = ? AND id != ?`,
                [sponsorRow.id, cameraId]
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
        SET sponsor_id = ?,
            sponsor_name = ?,
            sponsor_logo = ?,
            sponsor_url = ?,
            sponsor_package = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [sponsorRow?.id ?? null, sponsor_name, sponsor_logo, sponsor_url, sponsor_package, cameraId]);
}

/**
 * Remove sponsor from camera
 */
export function removeSponsorFromCamera(cameraId) {
    return execute(`
        UPDATE cameras 
        SET sponsor_id = NULL,
            sponsor_name = NULL,
            sponsor_logo = NULL,
            sponsor_url = NULL,
            sponsor_package = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [cameraId]);
}

/*
 * Cameras carrying a sponsor, for PUBLIC display.
 *
 * This used to be `SELECT * FROM cameras WHERE sponsor_name IS NOT NULL AND enabled = 1`, sent
 * straight to an unauthenticated caller by the controller with no projection in between. Two
 * Critical Invariants went out with it the moment any camera was given a sponsor:
 *
 *   * `private_rtsp_url` — 'Never expose RTSP URLs to the frontend'. `SELECT *` does not read
 *     the invariant; it reads the schema, and the schema has that column.
 *   * `camera_class` was never filtered, so an `owner_private` or `subscriber` camera given a
 *     sponsor would have appeared on a public surface, with its stream_key.
 *
 * The route comment above it asserted the opposite — 'they cannot leak admin-only metadata,
 * they filter to enabled cameras only'. Enabled was never the dangerous axis. A safety claim in
 * a comment stops the next reader from checking, which is how this survived.
 *
 * So: an explicit column list, not a star, and the community filter every public query owes.
 * The columns are exactly what SponsorBadge renders plus the identity needed to place it —
 * anything a future caller wants beyond this has to be added deliberately, one field at a time.
 */
export function getCamerasWithSponsors() {
    return query(`
        SELECT id, name, area_id, sponsor_name, sponsor_logo, sponsor_url, sponsor_package
        FROM cameras
        WHERE sponsor_name IS NOT NULL
          AND enabled = 1
          AND camera_class = 'community'
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
 * Berapa kamera yang saat ini tertaut ke tiap sponsor. Peta { [sponsorId]: jumlah }, dilipat
 * controller ke daftar sponsor supaya admin melihat cakupannya sekilas.
 *
 * Dikunci lewat sponsor_id. Sebelumnya lewat sponsor_name, yang berarti sponsor yang berganti
 * nama tampil dengan 0 kamera padahal kameranya masih membawa logonya - angka salah yang
 * justru muncul di saat operator paling percaya pada panelnya.
 */
export function countCamerasPerSponsor() {
    const rows = query(`
        SELECT sponsor_id, COUNT(*) AS camera_count
        FROM cameras
        WHERE sponsor_id IS NOT NULL AND enabled = 1
        GROUP BY sponsor_id
    `);
    const counts = {};
    for (const row of rows) {
        if (row?.sponsor_id) {
            counts[row.sponsor_id] = row.camera_count;
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
