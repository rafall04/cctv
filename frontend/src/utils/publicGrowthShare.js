/*
 * Purpose: Build branded public CCTV share URLs and text for areas and cameras.
 * Caller: AreaPublicPage, LandingTrendingCameras, and public share buttons.
 * Deps: Browser URL APIs.
 * MainFuncs: buildAreaShareText, buildCameraShareText, buildAreaUrl, buildCameraUrl.
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
