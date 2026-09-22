// Purpose: Decide which /api/thumbnails/* request paths may reach the static file handler.
// Caller: server.js thumbnail tenancy hook (runs in onRequest, before @fastify/static).
// Deps: None.
// MainFuncs: parseThumbnailRequestPath, decideThumbnailResponse.
// SideEffects: None; pure parsing/decision.
//
// WHY THIS IS DENY-BY-DEFAULT
// ---------------------------
// The thumbnail directory is served by @fastify/static, and the only thing standing
// between a rented/private camera's snapshot and the public internet is the hook
// that calls this. The hook previously let any unrecognised filename through
// ungated, on the assumption that the static handler would just 404 it — which is
// exactly the assumption the two advisories open against the pinned @fastify/static
// break (GHSA-83w8-p2f5-377r route-guard bypass via path traversal,
// GHSA-8pvw-jcv7-9cmj authorization bypass via non-canonical paths).
//
// So the rule is inverted: a request is refused unless it is unmistakably a
// thumbnail for one specific camera id. Production holds 31 files and every one of
// them is `{id}.jpg`, so nothing legitimate is lost.

const THUMBNAIL_PREFIX = '/api/thumbnails/';
const THUMBNAIL_NAME_RE = /^(\d+)(?:_temp)?\.jpg$/i;

/**
 * Classify a request URL for the thumbnail route.
 *
 * Returns one of:
 *   { kind: 'not_thumbnail' }        — URL is for some other route; ignore it.
 *   { kind: 'reject' }               — refuse with 404 (never reaches the file handler).
 *   { kind: 'thumbnail', cameraId }  — well-formed; caller still applies the tenancy check.
 */
export function parseThumbnailRequestPath(url) {
    if (typeof url !== 'string' || !url.startsWith(THUMBNAIL_PREFIX)) {
        return { kind: 'not_thumbnail' };
    }

    const raw = url.slice(THUMBNAIL_PREFIX.length).split('?')[0].split('#')[0];

    // Decode before matching. "%32%35.jpg" and "25.jpg" are the same file to the
    // static handler but different strings to a regex — matching raw text is how a
    // gate gets walked around rather than broken.
    let fileName;
    try {
        fileName = decodeURIComponent(raw);
    } catch {
        // A malformed escape sequence has no legitimate producer.
        return { kind: 'reject' };
    }

    // Decoding can reveal a separator that was hidden as %2F; a name containing one
    // is a traversal attempt, not a filename.
    if (fileName.includes('/') || fileName.includes('\\')) {
        return { kind: 'reject' };
    }

    const match = THUMBNAIL_NAME_RE.exec(fileName);
    if (!match) {
        return { kind: 'reject' };
    }

    return { kind: 'thumbnail', cameraId: Number(match[1]) };
}

/**
 * Turn a canViewLive verdict into the thumbnail response decision.
 *
 * The hook runs the SAME gate live HLS uses — for every camera, community included. The old
 * short-circuit (`!info || community → allow`) kept serving snapshots for disabled community
 * cameras and leftover files for deleted ids, and skipped the voucher area-gate entirely
 * (audit 2026-09-22, F2). canViewLive already answers 404 for missing/disabled, 402 for
 * voucher-gated, 403 for non-community unauthorized — those codes are intended semantics.
 *
 * Returns { status, body } when the request must be refused, or { allow: true,
 * gated } when it may proceed — `gated` marks private responses that must not populate
 * shared caches (community-public thumbnails stay edge-cacheable).
 */
export function decideThumbnailResponse(access, info) {
    if (!access?.allowed) {
        return { status: access?.statusCode || 403, body: { success: false, message: 'Forbidden' } };
    }
    return { allow: true, gated: info?.camera_class !== 'community' || !!access.voucherGated };
}

export default { parseThumbnailRequestPath, decideThumbnailResponse };
