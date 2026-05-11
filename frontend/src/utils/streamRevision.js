/**
 * Purpose: Adds camera stream revision cache-busting to HLS URLs.
 * Caller: VideoPlayer and stream lifecycle tests.
 * Deps: URLSearchParams.
 * MainFuncs: appendStreamRevision.
 * SideEffects: None.
 */

export function appendStreamRevision(url, revision) {
    if (!url || revision === undefined || revision === null || revision === '') {
        return url || '';
    }

    const [base, query = ''] = String(url).split('?');
    const params = new URLSearchParams(query);
    params.set('stream_rev', String(revision));
    return `${base}?${params.toString()}`;
}
