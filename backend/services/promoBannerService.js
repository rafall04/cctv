/*
Purpose: Manage provider promo banners — CRUD, per-camera/area targeting resolution, daily stats.
Caller: promoController (admin CRUD + public resolve/click endpoints).
Deps: connectionPool, promoImageService (rendition cleanup), timeService (local stat dates).
MainFuncs: resolvePromoBannerForContext, listPromoBanners, getPromoBannerById, createPromoBanner, updatePromoBanner, deletePromoBanner, setPromoBannerTargets, recordImpression, recordClick, getPromoBannerStats.
SideEffects: Reads/writes promo_banners, promo_banner_targets, promo_banner_stats; deletes rendition files on banner delete.
*/

import { query, queryOne, execute, transaction } from '../database/connectionPool.js';
import { getLocalDate } from './timeService.js';
import { deletePromoImage } from './promoImageService.js';

export const PROMO_PLACEMENTS = ['popup', 'area', 'landing', 'playback'];
export const PROMO_TARGET_MODES = ['all', 'area', 'camera'];

const MAX_WHATSAPP_MESSAGE_LEN = 500;

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

/**
 * Parse the stored placements JSON defensively — a malformed value must not take
 * the public endpoint down, it should just mean "no placements match".
 */
function parsePlacements(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.filter((p) => PROMO_PLACEMENTS.includes(p)) : [];
    } catch {
        return [];
    }
}

export function normalizePlacements(input) {
    const list = Array.isArray(input) ? input : [];
    const cleaned = [...new Set(list.filter((p) => PROMO_PLACEMENTS.includes(p)))];
    if (cleaned.length === 0) {
        throw badRequest('Pilih minimal satu lokasi tampil');
    }
    return cleaned;
}

export function normalizeTargetMode(mode) {
    if (!PROMO_TARGET_MODES.includes(mode)) {
        throw badRequest(`target_mode harus salah satu dari: ${PROMO_TARGET_MODES.join(', ')}`);
    }
    return mode;
}

/**
 * Build the wa.me URL for a banner, substituting the placeholders an operator can
 * use in the message template. Returns null when no WhatsApp number is set, so
 * the caller falls back to the free-form `cta_url`.
 */
export function buildWhatsAppUrl(promo, context = {}) {
    const digits = String(promo.whatsapp_number || '').replace(/\D/g, '');
    if (!digits) {
        return null;
    }
    // Indonesian operators type "08xx"; wa.me needs the country code.
    const international = digits.startsWith('0') ? `62${digits.slice(1)}` : digits;

    const template = promo.whatsapp_message || 'Halo, saya ingin bertanya tentang pemasangan CCTV.';
    const message = template
        .replace(/\{kamera\}/gi, context.cameraName || '-')
        .replace(/\{area\}/gi, context.areaName || '-')
        .slice(0, MAX_WHATSAPP_MESSAGE_LEN);

    return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
}

function rowToPublicPromo(row, context) {
    return {
        id: row.id,
        title: row.title,
        alt_text: row.alt_text || row.title,
        image_base: row.image_base,
        image_width: row.image_width,
        image_height: row.image_height,
        cta_label: row.cta_label || null,
        cta_url: buildWhatsAppUrl(row, context) || row.cta_url || null,
    };
}

/**
 * Pick the single best promo banner for one viewing context.
 *
 * Specificity wins over priority: a banner aimed at this exact camera beats one
 * aimed at its area, which beats a catch-all. Within the same specificity the
 * lower `priority` number wins, then the newest banner.
 *
 * @param {{cameraId?: number, areaId?: number, placement: string}} context
 * @returns {object|null} public-shaped promo, or null when nothing matches
 */
export function resolvePromoBannerForContext({ cameraId = null, areaId = null, placement } = {}) {
    if (!PROMO_PLACEMENTS.includes(placement)) {
        return null;
    }

    let resolvedAreaId = areaId;
    let cameraName = null;
    let areaName = null;

    if (cameraId) {
        // Only the area link is read here; no camera field is ever echoed back to
        // the caller, so this cannot become a probe for which cameras exist.
        const camera = queryOne(
            'SELECT c.id, c.name, c.area_id, a.name AS area_name FROM cameras c LEFT JOIN areas a ON a.id = c.area_id WHERE c.id = ?',
            [cameraId]
        );
        if (camera) {
            resolvedAreaId = camera.area_id;
            cameraName = camera.name;
            areaName = camera.area_name;
        }
    } else if (areaId) {
        const area = queryOne('SELECT name FROM areas WHERE id = ?', [areaId]);
        areaName = area ? area.name : null;
    }

    const today = getLocalDate();

    const rows = query(`
        SELECT p.*
        FROM promo_banners p
        WHERE p.active = 1
          AND p.image_base IS NOT NULL
          AND (p.start_date IS NULL OR p.start_date <= ?)
          AND (p.end_date IS NULL OR p.end_date >= ?)
          AND (
                p.target_mode = 'all'
             OR (p.target_mode = 'camera' AND ? IS NOT NULL AND EXISTS (
                    SELECT 1 FROM promo_banner_targets t
                    WHERE t.promo_id = p.id AND t.target_type = 'camera' AND t.target_id = ?
                ))
             OR (p.target_mode = 'area' AND ? IS NOT NULL AND EXISTS (
                    SELECT 1 FROM promo_banner_targets t
                    WHERE t.promo_id = p.id AND t.target_type = 'area' AND t.target_id = ?
                ))
          )
        ORDER BY
            CASE p.target_mode WHEN 'camera' THEN 0 WHEN 'area' THEN 1 ELSE 2 END,
            p.priority ASC,
            p.id DESC
    `, [today, today, cameraId, cameraId, resolvedAreaId, resolvedAreaId]);

    // Placements live as a JSON array; filtering them in JS keeps the SQL honest
    // (no LIKE-matching against JSON text) at a cost that is nil for a handful of banners.
    const match = rows.find((row) => parsePlacements(row.placements).includes(placement));
    return match ? rowToPublicPromo(match, { cameraName, areaName }) : null;
}

/* ---------------------------------------------------------------- admin CRUD */

const ADMIN_SELECT = `
    SELECT p.*,
        (SELECT COALESCE(SUM(s.impressions), 0) FROM promo_banner_stats s WHERE s.promo_id = p.id) AS total_impressions,
        (SELECT COALESCE(SUM(s.clicks), 0) FROM promo_banner_stats s WHERE s.promo_id = p.id) AS total_clicks
    FROM promo_banners p
`;

function attachTargets(promo) {
    if (!promo) {
        return null;
    }
    const targets = query(
        'SELECT target_type, target_id FROM promo_banner_targets WHERE promo_id = ? ORDER BY target_id',
        [promo.id]
    );
    return {
        ...promo,
        placements: parsePlacements(promo.placements),
        area_ids: targets.filter((t) => t.target_type === 'area').map((t) => t.target_id),
        camera_ids: targets.filter((t) => t.target_type === 'camera').map((t) => t.target_id),
    };
}

export function listPromoBanners() {
    return query(`${ADMIN_SELECT} ORDER BY p.active DESC, p.priority ASC, p.id DESC`).map(attachTargets);
}

export function getPromoBannerById(id) {
    return attachTargets(queryOne(`${ADMIN_SELECT} WHERE p.id = ?`, [id]));
}

function requirePromo(id) {
    const promo = queryOne('SELECT * FROM promo_banners WHERE id = ?', [id]);
    if (!promo) {
        const err = new Error('Promo tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }
    return promo;
}

/**
 * Replace a banner's targeting rows wholesale. Done inside one transaction so a
 * banner is never briefly untargeted (which would make it match nothing, or —
 * worse for an 'all' fallback — flash to every viewer).
 */
export function setPromoBannerTargets(promoId, { area_ids = [], camera_ids = [] } = {}) {
    const areaIds = [...new Set(area_ids.map(Number).filter(Number.isInteger))];
    const cameraIds = [...new Set(camera_ids.map(Number).filter(Number.isInteger))];

    const run = transaction(() => {
        execute('DELETE FROM promo_banner_targets WHERE promo_id = ?', [promoId]);
        for (const areaId of areaIds) {
            execute(
                'INSERT OR IGNORE INTO promo_banner_targets (promo_id, target_type, target_id) VALUES (?, ?, ?)',
                [promoId, 'area', areaId]
            );
        }
        for (const cameraId of cameraIds) {
            execute(
                'INSERT OR IGNORE INTO promo_banner_targets (promo_id, target_type, target_id) VALUES (?, ?, ?)',
                [promoId, 'camera', cameraId]
            );
        }
    });
    run();

    return { areaIds, cameraIds };
}

export function createPromoBanner(data) {
    const title = String(data.title || '').trim();
    if (!title) {
        throw badRequest('Judul promo wajib diisi');
    }
    const targetMode = normalizeTargetMode(data.target_mode || 'all');
    const placements = normalizePlacements(data.placements || ['popup']);

    const result = execute(`
        INSERT INTO promo_banners
            (title, alt_text, cta_label, cta_url, whatsapp_number, whatsapp_message,
             target_mode, placements, active, start_date, end_date, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        title,
        data.alt_text || null,
        data.cta_label || null,
        data.cta_url || null,
        data.whatsapp_number || null,
        data.whatsapp_message || null,
        targetMode,
        JSON.stringify(placements),
        data.active === false || data.active === 0 ? 0 : 1,
        data.start_date || null,
        data.end_date || null,
        Number.isInteger(data.priority) ? data.priority : 100,
    ]);

    setPromoBannerTargets(result.lastInsertRowid, data);
    return getPromoBannerById(result.lastInsertRowid);
}

export function updatePromoBanner(id, data) {
    requirePromo(id);

    const fields = [];
    const values = [];
    const assign = (column, value) => { fields.push(`${column} = ?`); values.push(value); };

    if (data.title !== undefined) {
        const title = String(data.title || '').trim();
        if (!title) {
            throw badRequest('Judul promo wajib diisi');
        }
        assign('title', title);
    }
    if (data.alt_text !== undefined) assign('alt_text', data.alt_text || null);
    if (data.cta_label !== undefined) assign('cta_label', data.cta_label || null);
    if (data.cta_url !== undefined) assign('cta_url', data.cta_url || null);
    if (data.whatsapp_number !== undefined) assign('whatsapp_number', data.whatsapp_number || null);
    if (data.whatsapp_message !== undefined) assign('whatsapp_message', data.whatsapp_message || null);
    if (data.target_mode !== undefined) assign('target_mode', normalizeTargetMode(data.target_mode));
    if (data.placements !== undefined) assign('placements', JSON.stringify(normalizePlacements(data.placements)));
    if (data.active !== undefined) assign('active', data.active ? 1 : 0);
    if (data.start_date !== undefined) assign('start_date', data.start_date || null);
    if (data.end_date !== undefined) assign('end_date', data.end_date || null);
    if (data.priority !== undefined) assign('priority', Number.isInteger(data.priority) ? data.priority : 100);

    if (fields.length > 0) {
        assign('updated_at', new Date().toISOString().replace('T', ' ').slice(0, 19));
        execute(`UPDATE promo_banners SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }

    if (data.area_ids !== undefined || data.camera_ids !== undefined) {
        const current = getPromoBannerById(id);
        setPromoBannerTargets(id, {
            area_ids: data.area_ids !== undefined ? data.area_ids : current.area_ids,
            camera_ids: data.camera_ids !== undefined ? data.camera_ids : current.camera_ids,
        });
    }

    return getPromoBannerById(id);
}

export function setPromoBannerImage(id, image) {
    const existing = requirePromo(id);

    execute(`
        UPDATE promo_banners
        SET image_base = ?, image_width = ?, image_height = ?, image_bytes = ?, updated_at = ?
        WHERE id = ?
    `, [
        image.imageBase,
        image.width,
        image.height,
        image.bytes,
        new Date().toISOString().replace('T', ' ').slice(0, 19),
        id,
    ]);

    // Only unlink the OLD renditions after the row points at the new ones, so a
    // crash in between leaves an orphan file rather than a banner with no image.
    if (existing.image_base && existing.image_base !== image.imageBase) {
        deletePromoImage(existing.image_base);
    }

    return getPromoBannerById(id);
}

export function deletePromoBanner(id) {
    const existing = requirePromo(id);
    const run = transaction(() => {
        execute('DELETE FROM promo_banner_targets WHERE promo_id = ?', [id]);
        execute('DELETE FROM promo_banner_stats WHERE promo_id = ?', [id]);
        execute('DELETE FROM promo_banners WHERE id = ?', [id]);
    });
    run();
    if (existing.image_base) {
        deletePromoImage(existing.image_base);
    }
    return true;
}

/* -------------------------------------------------------------------- stats */

function bumpStat(promoId, column, amount = 1) {
    if (!Number.isInteger(promoId) || promoId < 1) {
        return false;
    }
    const today = getLocalDate();
    // UPSERT keeps this a single statement per event; the UNIQUE(promo_id, stat_date)
    // index is what makes the conflict target valid.
    const result = execute(`
        INSERT INTO promo_banner_stats (promo_id, stat_date, ${column})
        SELECT ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM promo_banners WHERE id = ?)
        ON CONFLICT (promo_id, stat_date)
        DO UPDATE SET ${column} = ${column} + ?
    `, [promoId, today, amount, promoId, amount]);
    return result.changes > 0;
}

export function recordImpression(promoId) {
    return bumpStat(promoId, 'impressions');
}

export function recordClick(promoId) {
    return bumpStat(promoId, 'clicks');
}

/**
 * Daily impression/click series for the admin panel.
 */
export function getPromoBannerStats(promoId, days = 30) {
    const window = Number.isInteger(days) && days > 0 && days <= 365 ? days : 30;
    return query(`
        SELECT stat_date, impressions, clicks
        FROM promo_banner_stats
        WHERE promo_id = ?
        ORDER BY stat_date DESC
        LIMIT ?
    `, [promoId, window]);
}

export default {
    PROMO_PLACEMENTS,
    PROMO_TARGET_MODES,
    resolvePromoBannerForContext,
    listPromoBanners,
    getPromoBannerById,
    createPromoBanner,
    updatePromoBanner,
    setPromoBannerImage,
    setPromoBannerTargets,
    deletePromoBanner,
    recordImpression,
    recordClick,
    getPromoBannerStats,
    buildWhatsAppUrl,
};
