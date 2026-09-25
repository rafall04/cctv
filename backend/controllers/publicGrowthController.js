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
import { readFileSync, statSync, existsSync, mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const THUMBNAILS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'thumbnails');
const LCP_MINI_DIR = join(THUMBNAILS_DIR, '.lcp');
const INLINE_THUMB_MAX_BYTES = 8 * 1024;

/*
 * data: URI of a SMALL downscaled thumbnail, so the SSI fragment carries the
 * image bytes in the HTML itself (paint in the first frame even under CPU
 * throttling — see buildLcpCardFragment). The 160x90 mini (~3-4KB) is generated
 * once per source mtime by ffmpeg — the same binary thumbnailService already
 * uses — and cached at data/thumbnails/.lcp/{id}-{mtime}.jpg; regenerating the
 * source thumbnail changes its mtime, which mints a fresh mini name, so stale
 * minis can never outlive their source. Missing files, ffmpeg failures, or
 * oversized outputs all fall back to a plain src URL.
 *
 * Why not the full 320px file (~10KB)? Its base64 attribute (~14KB) finishes
 * streaming right AT the ~1.9s first-paint window under Slow 4G — the img tag
 * doesn't exist until the attribute closes, so it missed the frame; later
 * frames are starved by bundle-eval long tasks until React clears #root.
 */
const miniInflight = new Map();
async function inlineThumbnailDataUri(thumbnailPath) {
    const match = /^\/api\/thumbnails\/(\d{1,10})\.jpe?g$/.exec(String(thumbnailPath || ''));
    if (!match) {
        return null;
    }
    try {
        const source = join(THUMBNAILS_DIR, `${match[1]}.jpg`);
        const mini = join(LCP_MINI_DIR, `${match[1]}-${Math.trunc(statSync(source).mtimeMs)}.jpg`);
        if (!existsSync(mini)) {
            if (!miniInflight.has(mini)) {
                miniInflight.set(mini, (async () => {
                    mkdirSync(LCP_MINI_DIR, { recursive: true });
                    await execFileAsync('ffmpeg', [
                        '-y', '-loglevel', 'error', '-i', source,
                        '-vf', 'scale=160:90', '-q:v', '6', '-f', 'image2', mini,
                    ], { timeout: 8000 });
                })().finally(() => miniInflight.delete(mini)));
            }
            await miniInflight.get(mini);
        }
        const bytes = readFileSync(mini);
        return bytes.length <= INLINE_THUMB_MAX_BYTES
            ? `data:image/jpeg;base64,${bytes.toString('base64')}`
            : null;
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
            ? await inlineThumbnailDataUri(camera.thumbnail_path)
            : null;
        return reply.send(buildLcpCardFragment(camera, { inlineDataUri }));
    } catch (error) {
        console.error('LCP card fragment error:', error);
        return reply.send('');
    }
}
