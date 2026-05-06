/*
 * Purpose: Build branded public CCTV share URLs and text for areas and cameras.
 * Caller: AreaPublicPage, LandingTrendingCameras, and public share buttons.
 * Deps: Browser URL APIs.
 * MainFuncs: buildAreaShareText, buildCameraShareText, buildAreaUrl, buildCameraUrl, sharePublicText.
 * SideEffects: None.
 */

export function buildAreaUrl(slug, origin = window.location.origin) {
    return `${origin}/area/${encodeURIComponent(slug)}`;
}

export function buildCameraUrl(camera, origin = window.location.origin) {
    const areaSlug = camera.area_slug || camera.areaSlug || 'all';
    const baseUrl = buildAreaUrl(areaSlug, origin);
    return `${baseUrl}?camera=${encodeURIComponent(camera.id)}`;
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
