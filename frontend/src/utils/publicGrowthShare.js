/*
 * Purpose: Build branded public CCTV share URLs and text for areas and cameras.
 * Caller: AreaPublicPage, LandingTrendingCameras, and public share buttons.
 * Deps: Browser URL APIs.
 * MainFuncs: getPublicAreaSlug, buildAreaPath, buildAreaShareText, buildCameraShareText, buildAreaUrl, buildCameraUrl, sharePublicText.
 * SideEffects: None.
 */

import { createCameraSlug } from './slugify';

function normalizeSlug(value = '') {
    return String(value).trim().toLowerCase().replace(/\s+/g, '-');
}

function getCameraAreaSlug(camera = {}) {
    return normalizeSlug(
        camera.area_slug
        || camera.areaSlug
        || camera.slug
        || camera.area_name
        || camera.areaName
        || ''
    );
}

export function getPublicAreaSlug(areaInput = {}) {
    if (typeof areaInput === 'string') {
        return normalizeSlug(areaInput);
    }

    return normalizeSlug(
        areaInput.area_slug
        || areaInput.areaSlug
        || areaInput.slug
        || areaInput.area_name
        || areaInput.areaName
        || areaInput.name
        || ''
    );
}

export function buildAreaPath(areaInput) {
    const slug = getPublicAreaSlug(areaInput);
    return slug ? `/area/${encodeURIComponent(slug)}` : '/';
}

export function buildAreaUrl(areaInput, origin = window.location.origin) {
    return `${origin}${buildAreaPath(areaInput)}`;
}

export function buildCameraUrl(camera, origin = window.location.origin) {
    const cameraSlug = createCameraSlug(camera);
    const areaSlug = getCameraAreaSlug(camera);
    const cameraParam = cameraSlug ? `?camera=${encodeURIComponent(cameraSlug)}` : '';

    if (!areaSlug) {
        return `${origin}/${cameraParam}`;
    }

    return `${origin}${buildAreaPath(areaSlug)}${cameraParam}`;
}

export function buildAreaShareText(area, origin = window.location.origin) {
    const url = buildAreaUrl(area.slug, origin);
    return `CCTV Online ${area.name} - RAF NET\nPantau kamera publik area ${area.name}:\n${url}`;
}

export function buildCameraShareText(camera, origin = window.location.origin) {
    const url = buildCameraUrl(camera, origin);
    const areaName = camera.area_name || camera.areaName || 'Area publik';
    return `CCTV ${camera.name} - RAF NET\nArea: ${areaName}\nLive: ${url}`;
}

export async function sharePublicText({ text, title = 'RAF NET CCTV', navigatorRef = window.navigator }) {
    if (!text) {
        return { ok: false, status: 'empty' };
    }

    const sharePayload = { title, text };
    const canUseNativeShare = typeof navigatorRef?.share === 'function'
        && (typeof navigatorRef.canShare !== 'function' || navigatorRef.canShare(sharePayload));

    if (canUseNativeShare) {
        try {
            await navigatorRef.share(sharePayload);
            return { ok: true, status: 'native' };
        } catch (error) {
            if (error?.name === 'AbortError') {
                return { ok: false, status: 'aborted' };
            }
        }
    }

    if (typeof navigatorRef?.clipboard?.writeText === 'function') {
        await navigatorRef.clipboard.writeText(text);
        return { ok: true, status: 'clipboard' };
    }

    return { ok: false, status: 'unsupported' };
}
