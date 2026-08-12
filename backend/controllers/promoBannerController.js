/*
Purpose: HTTP handlers for provider promo banners — public resolve/click plus admin CRUD and image upload.
Caller: backend/routes/promoBannerRoutes.js, mounted under /api/promo-banners.
Deps: promoBannerService, promoImageService, securityAuditLogger.
MainFuncs: getPublicPromoBanner, trackPromoBannerClick, listPromoBanners, getPromoBanner, createPromoBanner, updatePromoBanner, uploadPromoBannerImage, deletePromoBanner, getPromoBannerStats.
SideEffects: Writes promo banner rows/stats and promo image files; emits admin audit events.
*/

import {
    resolvePromoBannerForContext,
    listPromoBanners as listPromoBannerRows,
    getPromoBannerById,
    createPromoBanner as createPromoBannerRow,
    updatePromoBanner as updatePromoBannerRow,
    setPromoBannerImage,
    deletePromoBanner as deletePromoBannerRow,
    getPromoBannerStats as getPromoBannerStatRows,
    recordImpression,
    recordClick,
} from '../services/promoBannerService.js';
import { savePromoImage, MAX_PROMO_UPLOAD_BYTES } from '../services/promoImageService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

function parseId(value) {
    const id = parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function fail(reply, error, fallback = 'Internal server error') {
    const code = error.statusCode || 500;
    if (code === 500) {
        console.error('Promo banner error:', error);
    }
    return reply.code(code).send({ success: false, message: code === 500 ? fallback : error.message });
}

function adminContext(request) {
    return {
        adminUserId: request.user?.id,
        adminUsername: request.user?.username,
    };
}

/* ------------------------------------------------------------------- public */

/**
 * Resolve the promo banner for one viewing context and count the impression.
 *
 * Returns `{ success: true, data: null }` rather than 404 when nothing matches —
 * "no promo configured" is the normal state, not an error, and the public
 * component should not have to treat it as one.
 */
export async function getPublicPromoBanner(request, reply) {
    try {
        const { placement, cameraId, areaId } = request.query || {};
        const promo = resolvePromoBannerForContext({
            placement: typeof placement === 'string' ? placement : '',
            cameraId: parseId(cameraId),
            areaId: parseId(areaId),
        });

        if (promo) {
            // Best-effort: a stats write must never cost the viewer their banner.
            try {
                recordImpression(promo.id);
            } catch (statsError) {
                console.error('Promo impression write failed:', statsError.message);
            }
        }

        // The impression count is only meaningful if this response is not replayed
        // from a shared cache, so it is explicitly uncacheable.
        reply.header('Cache-Control', 'no-store');
        return reply.send({ success: true, data: promo });
    } catch (error) {
        return fail(reply, error);
    }
}

export async function trackPromoBannerClick(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID promo tidak valid' });
        }
        // recordClick is a no-op for an unknown id (the INSERT is guarded by an
        // EXISTS on promo_banners), so a bogus id cannot create phantom stat rows.
        recordClick(id);
        reply.header('Cache-Control', 'no-store');
        return reply.send({ success: true });
    } catch (error) {
        return fail(reply, error);
    }
}

/* -------------------------------------------------------------------- admin */

export async function listPromoBanners(request, reply) {
    try {
        return reply.send({ success: true, data: listPromoBannerRows() });
    } catch (error) {
        return fail(reply, error);
    }
}

export async function getPromoBanner(request, reply) {
    try {
        const id = parseId(request.params.id);
        const promo = id ? getPromoBannerById(id) : null;
        if (!promo) {
            return reply.code(404).send({ success: false, message: 'Promo tidak ditemukan' });
        }
        return reply.send({ success: true, data: promo });
    } catch (error) {
        return fail(reply, error);
    }
}

export async function createPromoBanner(request, reply) {
    try {
        const promo = createPromoBannerRow(request.body || {});
        logAdminAction({
            action: 'promo_banner_created',
            targetType: 'promo_banner',
            targetId: promo.id,
            promoTitle: promo.title,
            ...adminContext(request),
        }, request);
        return reply.code(201).send({ success: true, message: 'Promo dibuat', data: promo });
    } catch (error) {
        return fail(reply, error);
    }
}

export async function updatePromoBanner(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID promo tidak valid' });
        }
        const promo = updatePromoBannerRow(id, request.body || {});
        logAdminAction({
            action: 'promo_banner_updated',
            targetType: 'promo_banner',
            targetId: id,
            promoTitle: promo.title,
            ...adminContext(request),
        }, request);
        return reply.send({ success: true, message: 'Promo diperbarui', data: promo });
    } catch (error) {
        return fail(reply, error);
    }
}

/**
 * Accept a base64-encoded poster and store its WebP renditions.
 *
 * base64-in-JSON rather than multipart: this is a rare admin action on an
 * image of a few MB, and the ~33% transfer overhead buys not adding a
 * body-parsing dependency to the public API surface.
 */
export async function uploadPromoBannerImage(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID promo tidak valid' });
        }

        const raw = request.body?.data;
        if (typeof raw !== 'string' || raw.length === 0) {
            return reply.code(400).send({ success: false, message: 'Data gambar tidak ada' });
        }
        // Tolerate a browser-style data URL prefix as well as bare base64.
        const base64 = raw.includes(',') && raw.slice(0, 64).includes('base64') ? raw.slice(raw.indexOf(',') + 1) : raw;

        // Reject on the encoded length before allocating the decoded buffer.
        if (base64.length > Math.ceil(MAX_PROMO_UPLOAD_BYTES / 3) * 4 + 8) {
            return reply.code(413).send({
                success: false,
                message: `Ukuran gambar melebihi ${Math.round(MAX_PROMO_UPLOAD_BYTES / (1024 * 1024))}MB`,
            });
        }

        const image = await savePromoImage(Buffer.from(base64, 'base64'));
        const promo = setPromoBannerImage(id, image);

        logAdminAction({
            action: 'promo_banner_image_uploaded',
            targetType: 'promo_banner',
            targetId: id,
            imageBase: image.imageBase,
            imageBytes: image.bytes,
            ...adminContext(request),
        }, request);

        return reply.send({
            success: true,
            message: 'Gambar diunggah',
            data: { promo, image: { ...image, renditions: image.renditions } },
        });
    } catch (error) {
        return fail(reply, error, 'Gagal mengunggah gambar');
    }
}

export async function deletePromoBanner(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID promo tidak valid' });
        }
        deletePromoBannerRow(id);
        logAdminAction({
            action: 'promo_banner_deleted',
            targetType: 'promo_banner',
            targetId: id,
            ...adminContext(request),
        }, request);
        return reply.send({ success: true, message: 'Promo dihapus' });
    } catch (error) {
        return fail(reply, error);
    }
}

export async function getPromoBannerStats(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID promo tidak valid' });
        }
        const days = parseInt(request.query?.days, 10);
        return reply.send({
            success: true,
            data: getPromoBannerStatRows(id, Number.isInteger(days) ? days : 30),
        });
    } catch (error) {
        return fail(reply, error);
    }
}
