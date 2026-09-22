/**
 * Purpose: Lock the thumbnail route's deny-by-default behaviour against gate bypasses.
 * Caller: Vitest backend suite.
 * Deps: utils/thumbnailRequestPolicy.
 * MainFuncs: parseThumbnailRequestPath.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { parseThumbnailRequestPath, decideThumbnailResponse } from '../utils/thumbnailRequestPolicy.js';

describe('parseThumbnailRequestPath', () => {
    it('ignores URLs that belong to other routes', () => {
        expect(parseThumbnailRequestPath('/api/cameras').kind).toBe('not_thumbnail');
        expect(parseThumbnailRequestPath('/hls/12/index.m3u8').kind).toBe('not_thumbnail');
        expect(parseThumbnailRequestPath(undefined).kind).toBe('not_thumbnail');
    });

    it('accepts the two real filename shapes and extracts the camera id', () => {
        expect(parseThumbnailRequestPath('/api/thumbnails/25.jpg'))
            .toEqual({ kind: 'thumbnail', cameraId: 25 });
        expect(parseThumbnailRequestPath('/api/thumbnails/25_temp.jpg'))
            .toEqual({ kind: 'thumbnail', cameraId: 25 });
        // Cache-busting query strings are normal traffic from the admin UI.
        expect(parseThumbnailRequestPath('/api/thumbnails/25.jpg?cb=1785600000'))
            .toEqual({ kind: 'thumbnail', cameraId: 25 });
    });

    /*
     * THE REGRESSION THIS FILE EXISTS FOR.
     *
     * The gate used to `return` — i.e. allow — on every name it did not recognise,
     * trusting @fastify/static to 404 it. The pinned version has two open
     * advisories saying precisely that trust is misplaced: GHSA-83w8-p2f5-377r
     * (route guard bypass via path traversal) and GHSA-8pvw-jcv7-9cmj
     * (authorization bypass via non-canonical URL paths). Anything that is not
     * unmistakably one camera's thumbnail must be refused HERE, before the file
     * handler ever sees it.
     */
    it.each([
        ['plain traversal', '/api/thumbnails/../../data/cctv.db'],
        ['encoded traversal', '/api/thumbnails/..%2f..%2fdata%2fcctv.db'],
        ['double-encoded traversal', '/api/thumbnails/%2e%2e%2f%2e%2e%2fdata%2fcctv.db'],
        ['encoded separator in name', '/api/thumbnails/25%2f..%2fsecret.jpg'],
        ['backslash separator', '/api/thumbnails/..\\..\\cctv.db'],
        ['malformed escape', '/api/thumbnails/%zz.jpg'],
        ['non-numeric name', '/api/thumbnails/logo.jpg'],
        ['wrong extension', '/api/thumbnails/25.png'],
        ['no extension', '/api/thumbnails/25'],
        ['empty name (directory)', '/api/thumbnails/'],
        ['id with suffix', '/api/thumbnails/25.jpg.map'],
        ['leading dot', '/api/thumbnails/.25.jpg'],
    ])('rejects %s', (_label, url) => {
        expect(parseThumbnailRequestPath(url).kind).toBe('reject');
    });

    /*
     * Percent-encoding must be resolved BEFORE matching, not after. "%32%35.jpg"
     * decodes to "25.jpg" and the static handler would serve camera 25 — so if the
     * gate matched the raw text it would classify it as "unknown" and, under the
     * old fail-open rule, wave it through WITHOUT the tenancy check. Decoding first
     * means this lands on the normal gated path with the correct camera id.
     */
    it('resolves percent-encoded digits to the same gated camera id', () => {
        expect(parseThumbnailRequestPath('/api/thumbnails/%32%35.jpg'))
            .toEqual({ kind: 'thumbnail', cameraId: 25 });
    });
});

/*
 * decideThumbnailResponse maps the canViewLive verdict to a response. The cases below are
 * exactly the audit 2026-09-22 F2 matrix: the old hook's `!info || community → allow`
 * short-circuit is gone, so every camera — including a disabled community row and a deleted
 * id with a stale file — now goes through the real gate.
 */
describe('decideThumbnailResponse', () => {
    const community = { camera_class: 'community' };
    const privat = { camera_class: 'owner_private' };

    it('404s a missing camera — a stale file must not outlive its row', () => {
        expect(decideThumbnailResponse(
            { allowed: false, statusCode: 404, reason: 'camera_not_found' }, null,
        )).toEqual({ status: 404, body: { success: false, message: 'Forbidden' } });
    });

    it('404s a disabled community camera — the old `community → allow` leak', () => {
        expect(decideThumbnailResponse(
            { allowed: false, statusCode: 404, reason: 'camera_not_found' }, community,
        ).status).toBe(404);
    });

    it('402s a voucher-gated community camera and marks it uncacheable when allowed', () => {
        expect(decideThumbnailResponse(
            { allowed: false, statusCode: 402, reason: 'voucher_required' }, community,
        ).status).toBe(402);
        expect(decideThumbnailResponse(
            { allowed: true, voucherGated: true }, community,
        )).toEqual({ allow: true, gated: true });
    });

    it('403s a private camera for an unauthorized viewer', () => {
        expect(decideThumbnailResponse(
            { allowed: false, statusCode: 403, reason: 'unauthorized' }, privat,
        ).status).toBe(403);
    });

    it('allows a public community camera WITHOUT the private-cache marker', () => {
        // Community thumbnails are public content — flagging them `gated` would set
        // `private, no-store` and strip CDN/browser caching off the landing grid.
        expect(decideThumbnailResponse({ allowed: true, voucherGated: false }, community))
            .toEqual({ allow: true, gated: false });
    });

    it('marks an authorized private-camera thumbnail gated', () => {
        expect(decideThumbnailResponse({ allowed: true }, privat))
            .toEqual({ allow: true, gated: true });
    });
});
