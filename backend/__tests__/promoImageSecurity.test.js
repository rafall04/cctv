/*
 * promoImageSecurity.test.js — the guards around promo poster storage.
 *
 * Two things are load-bearing here and both are easy to loosen by accident:
 *   1. the body-size allowance, which is the ONE route permitted past the global
 *      1MB cap and runs before auth;
 *   2. the filename allowlists, which are the only thing standing between a
 *      stored `image_base` and a path that escapes the promo directory.
 */
import { describe, it, expect } from 'vitest';
import { resolveBodySizeLimit, INPUT_SANITIZER_CONFIG } from '../middleware/inputSanitizer.js';
import { shouldSkipCsrf } from '../middleware/csrfProtection.js';
import { isSafeImageBase, promoImagePaths, PROMO_MEDIA_FILENAME_RE, PROMO_IMAGE_DIR } from '../services/promoImageService.js';

const { MAX_BODY_SIZE, MAX_UPLOAD_BODY_SIZE } = INPUT_SANITIZER_CONFIG;

describe('body-size allowance is scoped to exactly one route', () => {
    it('grants the upload ceiling to POST /api/promo-banners/:id/image', () => {
        expect(resolveBodySizeLimit({ method: 'POST', url: '/api/promo-banners/7/image' })).toBe(MAX_UPLOAD_BODY_SIZE);
        expect(resolveBodySizeLimit({ method: 'POST', url: '/api/promo-banners/7/image?x=1' })).toBe(MAX_UPLOAD_BODY_SIZE);
    });

    it('keeps the default 1MB cap everywhere else', () => {
        const others = [
            { method: 'POST', url: '/api/promo-banners' },
            { method: 'PUT', url: '/api/promo-banners/7' },
            { method: 'POST', url: '/api/promo-banners/7/click' },
            { method: 'POST', url: '/api/cameras' },
            { method: 'POST', url: '/api/auth/login' },
            { method: 'POST', url: '/' },
        ];
        for (const request of others) {
            expect(resolveBodySizeLimit(request), request.url).toBe(MAX_BODY_SIZE);
        }
    });

    it('does not let a different method borrow the allowance', () => {
        expect(resolveBodySizeLimit({ method: 'PUT', url: '/api/promo-banners/7/image' })).toBe(MAX_BODY_SIZE);
        expect(resolveBodySizeLimit({ method: 'GET', url: '/api/promo-banners/7/image' })).toBe(MAX_BODY_SIZE);
    });

    it('does not let a crafted path prefix or suffix borrow the allowance', () => {
        const crafted = [
            '/api/promo-banners/7/image/../../cameras',
            '/api/promo-banners/abc/image',
            '/api/promo-banners//image',
            '/evil/api/promo-banners/7/image',
            '/api/promo-banners/7/imagex',
        ];
        for (const url of crafted) {
            expect(resolveBodySizeLimit({ method: 'POST', url }), url).toBe(MAX_BODY_SIZE);
        }
    });

    it('tolerates a malformed request object rather than throwing before auth', () => {
        expect(resolveBodySizeLimit(undefined)).toBe(MAX_BODY_SIZE);
        expect(resolveBodySizeLimit({})).toBe(MAX_BODY_SIZE);
    });

    it('keeps the upload ceiling modest — it is reachable unauthenticated', () => {
        expect(MAX_UPLOAD_BODY_SIZE).toBeLessThanOrEqual(16 * 1024 * 1024);
        expect(MAX_UPLOAD_BODY_SIZE).toBeGreaterThan(MAX_BODY_SIZE);
    });
});

describe('image base names cannot escape the promo directory', () => {
    it('accepts only generated bases', () => {
        expect(isSafeImageBase('promo-0123456789ab')).toBe(true);
        expect(isSafeImageBase('promo-abcdef')).toBe(true);
    });

    it('rejects traversal, separators, and absolute paths', () => {
        const hostile = [
            '../../etc/passwd',
            'promo-../../etc/passwd',
            'promo-abcdef/../../secret',
            'promo-abc\\..\\..\\secret',
            '/etc/passwd',
            'promo-ABCDEF',
            'promo-abc',
            'promo-',
            '',
            null,
            undefined,
            42,
        ];
        for (const value of hostile) {
            expect(isSafeImageBase(value), String(value)).toBe(false);
        }
    });

    it('returns no paths at all for an unsafe base', () => {
        expect(promoImagePaths('../../etc/passwd')).toEqual([]);
        expect(promoImagePaths(null)).toEqual([]);
    });

    it('keeps every generated path inside the promo directory', () => {
        const paths = promoImagePaths('promo-0123456789ab');
        expect(paths.length).toBeGreaterThan(0);
        for (const p of paths) {
            expect(p.startsWith(PROMO_IMAGE_DIR)).toBe(true);
            expect(p.endsWith('.webp')).toBe(true);
        }
    });
});

describe('CSRF exemption covers only the anonymous click counter', () => {
    it('exempts the click endpoint, which anonymous visitors call without a token', () => {
        expect(shouldSkipCsrf('/api/promo-banners/7/click')).toBe(true);
        expect(shouldSkipCsrf('/api/promo-banners/7/click?x=1')).toBe(true);
    });

    it('still protects every admin mutation on the same prefix', () => {
        // A prefix-style skip would have stripped CSRF from all of these.
        const protectedUrls = [
            '/api/promo-banners',
            '/api/promo-banners/',
            '/api/promo-banners/7',
            '/api/promo-banners/7/image',
            '/api/promo-banners/7/stats',
            '/api/promo-banners/7/clickbait',
            '/api/promo-banners/abc/click',
            '/api/promo-banners/7/click/../../cameras',
        ];
        for (const url of protectedUrls) {
            expect(shouldSkipCsrf(url), url).toBe(false);
        }
    });
});

describe('served media filenames', () => {
    it('accepts only generated rendition filenames', () => {
        expect(PROMO_MEDIA_FILENAME_RE.test('promo-0123456789ab-1200.webp')).toBe(true);
        expect(PROMO_MEDIA_FILENAME_RE.test('promo-0123456789ab-640.webp')).toBe(true);
    });

    it('rejects anything else the static handler could otherwise be asked for', () => {
        const hostile = [
            '../../../backend/.env',
            'promo-0123456789ab-1200.webp/../../.env',
            '.upload-promo-0123456789ab.png',
            'promo-0123456789ab-999.webp',
            'promo-0123456789ab-1200.png',
            'promo-0123456789ab.webp',
            'cctv.db',
            '',
        ];
        for (const name of hostile) {
            expect(PROMO_MEDIA_FILENAME_RE.test(name), name).toBe(false);
        }
    });

    it('does not serve the in-progress upload temp file', () => {
        // savePromoImage writes `.upload-<base>.<ext>` next to the renditions.
        expect(PROMO_MEDIA_FILENAME_RE.test('.upload-promo-0123456789ab.jpg')).toBe(false);
    });
});
