/*
 * Purpose: Provide pure helpers for playback route search params.
 * Caller: Playback route and playback URL helper tests.
 * Deps: URLSearchParams browser API.
 * MainFuncs: getPlaybackUrlState, buildPlaybackSearchParams.
 * SideEffects: None; returns new URLSearchParams instances.
 */

const PLAYBACK_ONLY_PARAMS = ['camera', 'mode', 'view', 'scope', 'accessScope'];

/**
 * Turn a reported moment into a playback path that opens on it.
 *
 * @param {{camera: number|string, occurredAt: string, basePath?: string}} input
 * @returns {string|null} null when the moment cannot be placed on a clock.
 *
 * `occurredAt` is what a visitor typed into `<input type="datetime-local">`: a WALL CLOCK with no
 * timezone, e.g. "2026-08-02T14:30". `Date.parse` reads that in the reader's own zone, which is
 * the honest reading — the reporter meant the time on the clock beside them, and both they and the
 * operator are on the same local time in a single-city deployment. It is an approximation either
 * way, which is why the label beside this link says "sekitar" rather than stating a precise instant.
 */
export function buildPlaybackMomentPath({ camera, occurredAt, basePath = '/playback' }) {
    if (!camera || !occurredAt) return null;

    const at = Date.parse(occurredAt);
    if (!Number.isFinite(at)) return null;

    const params = new URLSearchParams();
    params.set('cam', String(camera));
    params.set('t', String(at));
    return `${basePath}?${params.toString()}`;
}

export function getPlaybackUrlState(searchParams) {
    const viewParam = searchParams.get('view');
    const modeParam = searchParams.get('mode');

    return {
        cameraParam: searchParams.get('cam'),
        timestampParam: searchParams.get('t'),
        isLegacyRootPlayback: viewParam === 'playback' || modeParam === 'playback',
    };
}

export function buildPlaybackSearchParams({
    currentParams,
    camera,
    timestamp,
}) {
    const nextParams = new URLSearchParams(currentParams);

    PLAYBACK_ONLY_PARAMS.forEach((param) => nextParams.delete(param));

    if (camera) {
        nextParams.set('cam', String(camera));
    } else {
        nextParams.delete('cam');
    }

    if (timestamp !== null && timestamp !== undefined && timestamp !== '') {
        nextParams.set('t', String(timestamp));
    } else {
        nextParams.delete('t');
    }

    return nextParams;
}
