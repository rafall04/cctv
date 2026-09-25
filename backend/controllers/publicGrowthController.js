/**
 * Purpose: Handle public growth API responses for area pages, discovery, and trending CCTV.
 * Caller: backend/routes/publicGrowthRoutes.js.
 * Deps: publicGrowthService.
 * MainFuncs: getPublicArea, getPublicAreaCameras, getPublicTrendingCameras, getPublicDiscovery.
 * SideEffects: Reads sanitized public CCTV data.
 */

import {
    getPublicAreaBySlug,
    getPublicAreaCameras as getPublicAreaCamerasData,
    getPublicDiscovery as getPublicDiscoveryData,
    getTrendingCameras,
} from '../services/publicGrowthService.js';
import { pickFirstGridCamera, buildLcpCardFragment } from '../services/publicLandingProjection.js';
import cameraService from '../services/cameraService.js';
import areaService from '../services/areaService.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const THUMBNAILS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'thumbnails');
const INLINE_THUMB_MAX_BYTES = 40 * 1024;

/*
 * data: URI of the LOCAL thumbnail file, so the SSI fragment carries the image
 * bytes in the HTML itself (paint in the first frame even under CPU throttling —
 * see buildLcpCardFragment). Only /api/thumbnails/{id}.{ext} paths map to files
 * we serve statically; digits-only id means no traversal is possible. External
 * snapshots, missing files, or oversized ones fall back to a plain src URL.
 */
function inlineThumbnailDataUri(thumbnailPath) {
    const match = /^\/api\/thumbnails\/(\d{1,10})\.(jpe?g|png|webp)$/.exec(String(thumbnailPath || ''));
    if (!match) {
        return null;
    }
    try {
        const bytes = readFileSync(join(THUMBNAILS_DIR, `${match[1]}.${match[2]}`));
        if (bytes.length > INLINE_THUMB_MAX_BYTES) {
            return null;
        }
        const mime = match[2] === 'jpg' ? 'jpeg' : match[2];
        return `data:image/${mime};base64,${bytes.toString('base64')}`;
    } catch {
        return null;
    }
}

function sendError(reply, error, fallbackMessage) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
        success: false,
        message: statusCode === 500 ? fallbackMessage : error.message,
    });
}

export async function getPublicArea(request, reply) {
    try {
        const data = getPublicAreaBySlug(request.params.slug);
        return reply.send({ success: true, data });
    } catch (error) {
        return sendError(reply, error, 'Internal server error');
    }
}

export async function getPublicAreaCameras(request, reply) {
    try {
        const data = getPublicAreaCamerasData(request.params.slug);
        return reply.send({ success: true, data });
    } catch (error) {
        return sendError(reply, error, 'Internal server error');
    }
}

export async function getPublicTrendingCameras(request, reply) {
    try {
        const data = getTrendingCameras({
            areaSlug: request.query?.areaSlug || '',
            limit: request.query?.limit,
        });
        return reply.send({ success: true, data });
    } catch (error) {
        return sendError(reply, error, 'Internal server error');
    }
}

export async function getPublicDiscovery(request, reply) {
    try {
        const data = getPublicDiscoveryData({
            limit: request.query?.limit,
        });
        return reply.send({ success: true, data });
    } catch (error) {
        return sendError(reply, error, 'Internal server error');
    }
}

/*
 * SSI fragment for index.html's boot shell: the real first-grid-card <img> with
 * src already resolved, so the LCP thumbnail starts downloading with the HTML.
 * Always answers 200 — an error body would end up rendered INSIDE the page by
 * nginx's include, so failures degrade to an empty fragment (the inline-JS
 * fallback still fills the slot later) and get logged, not returned.
 */
export async function getPublicLcpCard(request, reply) {
    reply.type('text/html; charset=utf-8');
    try {
        const cameras = cameraService.getPublicLandingCameraList();
        const { areas } = areaService.getAllAreas({ publicOnly: true });
        const camera = pickFirstGridCamera(cameras, areas);
        // Inline only when the fragment's effective src IS the local thumbnail —
        // an external snapshot is the card's preferred image and can't be inlined.
        const inlineDataUri = camera && !camera.external_snapshot_url
            ? inlineThumbnailDataUri(camera.thumbnail_path)
            : null;
        return reply.send(buildLcpCardFragment(camera, { inlineDataUri }));
    } catch (error) {
        console.error('LCP card fragment error:', error);
        return reply.send('');
    }
}
