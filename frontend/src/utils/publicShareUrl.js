const VALID_LAYOUT_MODES = new Set(['simple', 'full']);
const VALID_LIVE_VIEWS = new Set(['map', 'grid']);

function toSearchParams(searchParams) {
    if (searchParams instanceof URLSearchParams) {
        return searchParams;
    }

    if (typeof searchParams === 'string') {
        return new URLSearchParams(searchParams);
    }

    return new URLSearchParams();
}

export function getPublicLayoutMode(searchParams) {
    const params = toSearchParams(searchParams);
    const mode = params.get('mode');

    if (VALID_LAYOUT_MODES.has(mode)) {
        return mode;
    }

    return 'full';
}

export function getPublicLiveView(searchParams) {
    const params = toSearchParams(searchParams);
    const view = params.get('view');

    if (VALID_LIVE_VIEWS.has(view)) {
        return view;
    }

    return 'map';
}

export function buildPublicCameraShareUrl({
    origin = typeof window !== 'undefined' ? window.location.origin : '',
    camera,
}) {
    if (!camera) {
        return `${origin}/`;
    }

    const params = new URLSearchParams();
    params.set('camera', camera);

    return `${origin}/?${params.toString()}`;
}

export function buildPublicPlaybackShareUrl({
    origin = typeof window !== 'undefined' ? window.location.origin : '',
    camera,
    timestamp,
}) {
    const params = new URLSearchParams();

    if (camera) {
        params.set('cam', camera);
    }

    if (timestamp !== null && timestamp !== undefined) {
        params.set('t', String(timestamp));
    }

    const queryString = params.toString();
    return queryString ? `${origin}/playback?${queryString}` : `${origin}/playback`;
}
