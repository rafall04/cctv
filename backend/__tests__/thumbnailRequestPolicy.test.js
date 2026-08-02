/**
 * Purpose: Lock the thumbnail route's deny-by-default behaviour against gate bypasses.
 * Caller: Vitest backend suite.
 * Deps: utils/thumbnailRequestPolicy.
 * MainFuncs: parseThumbnailRequestPath.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { parseThumbnailRequestPath } from '../utils/thumbnailRequestPolicy.js';

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
