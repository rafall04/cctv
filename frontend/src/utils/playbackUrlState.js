/*
 * Purpose: Provide pure helpers for playback route search params.
 * Caller: Playback route and playback URL helper tests.
 * Deps: URLSearchParams browser API.
 * MainFuncs: getPlaybackUrlState, buildPlaybackSearchParams.
 * SideEffects: None; returns new URLSearchParams instances.
 */

const PLAYBACK_ONLY_PARAMS = ['camera', 'scope', 'accessScope'];

export function getPlaybackUrlState(searchParams) {
    return {
        cameraParam: searchParams.get('cam'),
        timestampParam: searchParams.get('t'),
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
