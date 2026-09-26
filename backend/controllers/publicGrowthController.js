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
import { pickFirstGridCamera, buildLcpCardFragment, buildOgMetaFragment } from '../services/publicLandingProjection.js';
import cameraService from '../services/cameraService.js';
import areaService from '../services/areaService.js';
import brandingService from '../services/brandingService.js';
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

/*
 * SSI include target for the OG/Twitter share-preview tags in index.html's <head>.
 * Query is `?path=$uri&camera=$arg_camera` — nginx passes the request's normalized
 * path and raw ?camera= slug so this route can resolve WHO the shared page is about
 * without trusting any free-form URL text. Lookups run ONLY against the public
 * landing list / public area service, so a private camera slug simply isn't found
 * and yields an empty fragment — nothing private can ever leak through here.
 *
 * Cheap-path first: requests with no camera arg and a non-/area/ path return ''
 * without touching the camera list (this runs as an SSI subrequest on EVERY
 * index.html load — the common case must stay ~0ms).
 * Always answers 200: an error body would be rendered INSIDE <head> by nginx.
 */
function resolveOgImage(camera, origin) {
    const raw = camera?.external_snapshot_url || camera?.thumbnail_path || '';
    if (!raw) return null;
    let url = String(raw);
    if (url.charAt(0) === '/') url = `${origin}${url}`;
    if (!/^https?:\/\//i.test(url)) return null;
    if (url.indexOf(`${origin}/api/thumbnails/`) === 0 && camera.thumbnail_updated_at) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(camera.thumbnail_updated_at);
    }
    return url;
}

export async function getPublicOgMeta(request, reply) {
    reply.type('text/html; charset=utf-8');
    try {
        // `u` carries the ORIGINAL request URI ($request_uri) — $uri would arrive
        // as /index.html because try_files rewrites SPA routes before SSI runs.
        const rawUri = String(request.query?.u || '/');
        const rawPath = String(rawUri.split('?')[0] || '/');
        const path = /^\/[a-z0-9\-/]*$/i.test(rawPath) ? rawPath : '/';
        const uCamera = /[?&]camera=([^&]*)/.exec(rawUri)?.[1];
        const cameraSlug = String(request.query?.camera || uCamera || '');
        const areaMatch = /^\/area\/([a-z0-9][a-z0-9-]*)$/i.exec(path);
        const cameraId = Number.parseInt((cameraSlug.split('-')[0] || ''), 10);
        if (!Number.isFinite(cameraId) && !areaMatch) {
            return reply.send('');
        }

        const proto = request.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https';
        const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
        const origin = `${proto}://${host}`;
        const siteName = brandingService.getBrandingSettings().company_name || null;

        if (Number.isFinite(cameraId)) {
            const camera = cameraService.getPublicLandingCameraList()
                .find((candidate) => candidate.id === cameraId);
            if (camera) {
                const safeSlug = encodeURIComponent(cameraSlug);
                const imageUrl = resolveOgImage(camera, origin) || `${origin}/og-image.png`;
                return reply.send(buildOgMetaFragment({
                    title: `${camera.name}${camera.area_name ? ` — ${camera.area_name}` : ''}`,
                    description: camera.area_name
                        ? `Pantau siaran langsung ${camera.name} di ${camera.area_name} — CCTV online 24 jam.`
                        : `Pantau siaran langsung ${camera.name} — CCTV online 24 jam.`,
                    url: `${origin}${path === '/' ? '/' : path}?camera=${safeSlug}`,
                    imageUrl,
                    imageAlt: `${camera.name} preview`,
                    siteName,
                }));
            }
            return reply.send('');
        }

        try {
            const area = getPublicAreaBySlug(areaMatch[1]);
            const thumbed = getPublicAreaCamerasData(area.slug)
                .find((candidate) => candidate.external_snapshot_url || candidate.thumbnail_path);
            return reply.send(buildOgMetaFragment({
                title: `CCTV ${area.name}`,
                description: `Pantau ${area.camera_count} kamera CCTV publik di ${area.name} — live 24 jam.`,
                url: `${origin}/area/${area.slug}`,
                imageUrl: (thumbed && resolveOgImage(thumbed, origin)) || `${origin}/og-image.png`,
                imageAlt: `CCTV ${area.name} preview`,
                siteName,
            }));
        } catch (error) {
            if (error.statusCode !== 404) throw error;
            return reply.send('');
        }
    } catch (error) {
        console.error('OG meta fragment error:', error);
        return reply.send('');
    }
}
