/**
 * Purpose: Guard the affiliate product-photo pipeline and the door it is served through — that
 *          generalising promoImageService did NOT move the promo's own files, that the affiliate
 *          filename allowlist cannot be walked out of its directory, that the two body-size
 *          ceilings agree, and that a real rendition actually reaches a real Fastify.
 * Caller: Backend test gate (vitest, node env).
 * Deps: vitest, fastify + @fastify/static (the real ones), fs, promoImageService, inputSanitizer,
 *       affiliateMediaRoutes.
 * SideEffects: Writes and removes a handful of files under backend/data/promos and
 *              backend/data/affiliate — all of them fixtures this file creates, none of them a
 *              file any other test or the app depends on. Importing inputSanitizer pulls in
 *              securityAuditLogger and therefore opens the shared READ connection pool, exactly as
 *              promoImageSecurity.test.js already does; nothing here reads a row or writes one.
 *              ffmpeg is never invoked (savePromoImage is deliberately not called — encoding is
 *              promoImageEncode.test.js's job).
 *
 * WHY A REGRESSION TEST FOR THE PROMO SIDE LIVES IN AN AFFILIATE FILE
 * -------------------------------------------------------------------
 * The affiliate photo did not get its own copy of the image pipeline; promoImageService was
 * GENERALISED, every entry point gaining an options argument whose defaults are supposed to
 * reproduce the promo behaviour byte-for-byte. "Supposed to" is the whole risk: the promo poster is
 * live in production, its files are already on disk under names the database points at, and a
 * generalisation that quietly changed the default directory, the rendition keys or the filename
 * prefix would orphan every existing poster — with no error anywhere, just banners that stop
 * appearing. So the change that introduced the options object is exactly the change that owes a
 * test asserting the CONCRETE default values, not merely that they exist.
 *
 * WHY THE ALLOWLIST TESTS ASSERT ON BOTH FEATURES AT ONCE
 * -------------------------------------------------------
 * Two regexes are now built by interpolating a per-feature prefix. The failure mode that matters is
 * not "the regex is too strict", it is "the regex became a wildcard", and a wildcard is invisible
 * while you only ever test it with its own feature's names. Feeding each allowlist the OTHER
 * feature's filenames is the cheapest way to notice: they must refuse each other.
 *
 * WHY THERE IS A REAL FASTIFY HERE
 * ---------------------------------
 * Earned on the promo side, in production: that media route was only ever tested with filenames
 * that do NOT exist, which 404 in the allowlist hook before the file-serving path is reached at
 * all. A broken @fastify/static configuration therefore shipped green and every real poster request
 * failed. The lesson is not about one callback — it is that a media route tested only with
 * hostile names has never once proven it can serve anything. So the happy path here uses a real
 * file, a real request and asserts on the BYTES, and the refusals are aimed at a file that EXISTS
 * on disk next to the good ones (a 404 for a file that was never there proves nothing about the
 * allowlist). Both halves are checked to fail: pointing the static root at the other feature's
 * directory breaks the first, and disabling the hook breaks the second.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import affiliateMediaRoutes from '../routes/affiliateMediaRoutes.js';
import {
    AFFILIATE_IMAGE_DIR,
    AFFILIATE_IMAGE_OPTIONS,
    AFFILIATE_MEDIA_FILENAME_RE,
    AFFILIATE_RENDITIONS,
    MAX_AFFILIATE_UPLOAD_BYTES,
    PROMO_IMAGE_DIR,
    PROMO_IMAGE_OPTIONS,
    PROMO_MEDIA_FILENAME_RE,
    PROMO_RENDITIONS,
    buildMediaFilenameRe,
    deletePromoImage,
    ensurePromoImageDir,
    isSafeImageBase,
    promoImagePaths,
} from '../services/promoImageService.js';
import { resolveBodySizeLimit, INPUT_SANITIZER_CONFIG } from '../middleware/inputSanitizer.js';

const { MAX_BODY_SIZE, MAX_UPLOAD_BODY_SIZE } = INPUT_SANITIZER_CONFIG;

// A real (tiny) WebP: "RIFF" + size + "WEBP" + a VP8L payload. Same fixture the promo media test
// uses, because what is being proven is that real bytes come back, not that a stub was called.
const WEBP_BYTES = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

const AFF_BASE = 'aff-aaaabbbbccccdddd';
const AFF_FILES = [`${AFF_BASE}-320.webp`, `${AFF_BASE}-160.webp`];
const INTRUDER = 'not-a-rendition.txt';

let app;

beforeAll(async () => {
    mkdirSync(AFFILIATE_IMAGE_DIR, { recursive: true });
    for (const name of AFF_FILES) {
        writeFileSync(join(AFFILIATE_IMAGE_DIR, name), WEBP_BYTES);
    }
    // A real file the allowlist must refuse, sitting right next to the ones it must serve.
    writeFileSync(join(AFFILIATE_IMAGE_DIR, INTRUDER), 'do not serve me');

    app = Fastify();
    await app.register(affiliateMediaRoutes);
    await app.ready();
});

afterAll(async () => {
    if (app) await app.close();
    for (const name of [...AFF_FILES, INTRUDER]) {
        const path = join(AFFILIATE_IMAGE_DIR, name);
        if (existsSync(path)) rmSync(path, { force: true });
    }
});

describe('the promo defaults survived the generalisation, byte-for-byte', () => {
    /*
     * These are the values production already has on disk and in the database. Asserted as
     * literals, not as "is defined" or "matches the constant": comparing the default to the
     * constant it is built from would agree with whatever the module decided today, which is the
     * one thing this test exists to catch.
     */
    it('still stores posters in backend/data/promos under the promo- prefix', () => {
        expect(PROMO_IMAGE_OPTIONS.dir).toBe(PROMO_IMAGE_DIR);
        expect(PROMO_IMAGE_DIR.endsWith(join('data', 'promos'))).toBe(true);
        expect(PROMO_IMAGE_OPTIONS.prefix).toBe('promo-');
        expect(PROMO_IMAGE_OPTIONS.maxBytes).toBe(5 * 1024 * 1024);
    });

    it('still writes exactly the 1200px and 640px renditions', () => {
        expect(PROMO_RENDITIONS).toEqual([
            { key: '1200', width: 1200 },
            { key: '640', width: 640 },
        ]);
        expect(PROMO_IMAGE_OPTIONS.renditions).toBe(PROMO_RENDITIONS);
    });

    it('builds the same poster paths when called with NO options at all', () => {
        // The one-argument call is how promoBannerService and promoBannerController still call in.
        expect(promoImagePaths('promo-0123456789ab')).toEqual([
            join(PROMO_IMAGE_DIR, 'promo-0123456789ab-1200.webp'),
            join(PROMO_IMAGE_DIR, 'promo-0123456789ab-640.webp'),
        ]);
    });

    it('accepts the same poster base names when called with NO options at all', () => {
        expect(isSafeImageBase('promo-0123456789ab')).toBe(true);
        expect(isSafeImageBase('promo-abcdef')).toBe(true);
        expect(isSafeImageBase('aff-0123456789ab')).toBe(false);
    });

    it('serves the same poster filename pattern when called with NO options at all', () => {
        expect(buildMediaFilenameRe().source).toBe(PROMO_MEDIA_FILENAME_RE.source);
        expect(PROMO_MEDIA_FILENAME_RE.test('promo-0123456789ab-1200.webp')).toBe(true);
        expect(PROMO_MEDIA_FILENAME_RE.test('promo-0123456789ab-640.webp')).toBe(true);
    });

    it('still resolves ensurePromoImageDir() to the promo directory', () => {
        expect(ensurePromoImageDir()).toBe(PROMO_IMAGE_DIR);
    });

    it('deletes a REAL poster file through the no-options path', () => {
        /*
         * The strongest form of the regression: put actual files where the promo pipeline says it
         * puts them, then delete them the way the promo code does — with no options. If the
         * defaults had drifted to another directory this returns 0 and the files are still there,
         * which is precisely how a live poster would be orphaned in production.
         */
        const base = 'promo-affiliatespecfixture';
        mkdirSync(PROMO_IMAGE_DIR, { recursive: true });
        const paths = [
            join(PROMO_IMAGE_DIR, `${base}-1200.webp`),
            join(PROMO_IMAGE_DIR, `${base}-640.webp`),
        ];
        for (const path of paths) writeFileSync(path, WEBP_BYTES);

        expect(deletePromoImage(base)).toBe(2);
        for (const path of paths) expect(existsSync(path)).toBe(false);
    });
});

describe('the affiliate options describe a card thumbnail, not a poster', () => {
    it('stores product photos in their own directory under the aff- prefix', () => {
        expect(AFFILIATE_IMAGE_OPTIONS.dir).toBe(AFFILIATE_IMAGE_DIR);
        expect(AFFILIATE_IMAGE_DIR.endsWith(join('data', 'affiliate'))).toBe(true);
        expect(AFFILIATE_IMAGE_OPTIONS.prefix).toBe('aff-');
        // A separate URL space from the poster's, so a partner's files can be retired or blocked
        // without touching the provider's own advertising.
        expect(AFFILIATE_IMAGE_DIR).not.toBe(PROMO_IMAGE_DIR);
    });

    it('writes exactly the 320px and 160px renditions', () => {
        // 1x and 2x of a card that is at most ~320 CSS px wide. This image loads UNDER A LIVE
        // VIDEO on a phone, so a poster-sized rendition here competes with the stream for
        // bandwidth — the sizing is the feature, not a detail.
        expect(AFFILIATE_RENDITIONS).toEqual([
            { key: '320', width: 320 },
            { key: '160', width: 160 },
        ]);
        expect(AFFILIATE_IMAGE_OPTIONS.renditions).toBe(AFFILIATE_RENDITIONS);
    });

    it('keeps every generated path inside the affiliate directory', () => {
        const paths = promoImagePaths(AFF_BASE, AFFILIATE_IMAGE_OPTIONS);
        expect(paths).toEqual([
            join(AFFILIATE_IMAGE_DIR, `${AFF_BASE}-320.webp`),
            join(AFFILIATE_IMAGE_DIR, `${AFF_BASE}-160.webp`),
        ]);
        for (const path of paths) {
            expect(path.startsWith(AFFILIATE_IMAGE_DIR)).toBe(true);
            expect(path.endsWith('.webp')).toBe(true);
        }
    });
});

describe('an affiliate image base cannot escape its directory', () => {
    it('accepts a well-formed generated base', () => {
        expect(isSafeImageBase(AFF_BASE, AFFILIATE_IMAGE_OPTIONS)).toBe(true);
        expect(isSafeImageBase('aff-0123456789abcdef', AFFILIATE_IMAGE_OPTIONS)).toBe(true);
        expect(isSafeImageBase('aff-abcdef', AFFILIATE_IMAGE_OPTIONS)).toBe(true);
    });

    it('rejects traversal, separators and absolute paths', () => {
        const hostile = [
            '../../etc/passwd',
            'aff-../../etc/passwd',
            'aff-abcdef/../../secret',
            'aff-abc\\..\\..\\secret',
            'aff-abcdef/nested',
            '/etc/passwd',
            'C:\\Windows\\win.ini',
            'aff-ABCDEF',
            'aff-abc',
            'aff-',
            'aff-abcdef.webp',
            '',
            null,
            undefined,
            42,
        ];
        for (const value of hostile) {
            expect(isSafeImageBase(value, AFFILIATE_IMAGE_OPTIONS), String(value)).toBe(false);
        }
    });

    it('returns no paths at all for an unsafe base — never a partial list', () => {
        expect(promoImagePaths('../../etc/passwd', AFFILIATE_IMAGE_OPTIONS)).toEqual([]);
        expect(promoImagePaths(null, AFFILIATE_IMAGE_OPTIONS)).toEqual([]);
        // ...so a doctored base deletes nothing, rather than deleting something else.
        expect(deletePromoImage('../../etc/passwd', AFFILIATE_IMAGE_OPTIONS)).toBe(0);
    });

    it('refuses to build an allowlist out of a prefix that could act as a pattern', () => {
        // Both regexes are built by interpolating the prefix, so a prefix carrying regex syntax
        // would turn an allowlist into a wildcard. It is constrained before it ever reaches RegExp.
        for (const prefix of ['../', 'a.*-', 'aff/', 'AFF-', 'aff', '.*', '']) {
            expect(() => isSafeImageBase('aff-abcdef', { prefix }), prefix).toThrow(/[Pp]refiks/);
            expect(() => buildMediaFilenameRe({ prefix }), prefix).toThrow(/[Pp]refiks/);
        }
    });

    it('refuses an empty rendition list, which would produce an allowlist matching nothing', () => {
        expect(() => buildMediaFilenameRe({ prefix: 'aff-', renditions: [] })).toThrow(/rendition/i);
    });

    it('will not let one feature\'s names through the other feature\'s allowlist', () => {
        expect(isSafeImageBase('promo-0123456789ab', AFFILIATE_IMAGE_OPTIONS)).toBe(false);
        expect(isSafeImageBase(AFF_BASE, PROMO_IMAGE_OPTIONS)).toBe(false);
        expect(AFFILIATE_MEDIA_FILENAME_RE.test('promo-0123456789ab-1200.webp')).toBe(false);
        expect(PROMO_MEDIA_FILENAME_RE.test(`${AFF_BASE}-320.webp`)).toBe(false);
    });
});

describe('affiliate media filenames the static handler may be asked for', () => {
    it('accepts only generated rendition filenames', () => {
        expect(AFFILIATE_MEDIA_FILENAME_RE.test(`${AFF_BASE}-320.webp`)).toBe(true);
        expect(AFFILIATE_MEDIA_FILENAME_RE.test(`${AFF_BASE}-160.webp`)).toBe(true);
    });

    it('rejects anything else', () => {
        const hostile = [
            '../../../backend/.env',
            `${AFF_BASE}-320.webp/../../.env`,
            `.upload-${AFF_BASE}.png`,
            `${AFF_BASE}-1200.webp`,
            `${AFF_BASE}-999.webp`,
            `${AFF_BASE}-320.png`,
            `${AFF_BASE}.webp`,
            'aff-SHOUTING-320.webp',
            'cctv.db',
            '',
        ];
        for (const name of hostile) {
            expect(AFFILIATE_MEDIA_FILENAME_RE.test(name), name).toBe(false);
        }
    });
});

describe('the two body-size ceilings agree, and cover exactly one route', () => {
    /*
     * They must agree because they are enforced in different places: inputSanitizer's hook runs on
     * every request BEFORE auth, and the route's own bodyLimit runs after matching. If the route
     * ever allowed more than the hook, an operator would get a 413 from a hook that never reaches
     * the controller's Indonesian error message, and nobody would know which limit spoke.
     */
    it('grants the upload ceiling to POST /api/admin/affiliate/offers/:id/image', () => {
        expect(resolveBodySizeLimit({ method: 'POST', url: '/api/admin/affiliate/offers/7/image' }))
            .toBe(MAX_UPLOAD_BODY_SIZE);
        expect(resolveBodySizeLimit({ method: 'POST', url: '/api/admin/affiliate/offers/7/image?x=1' }))
            .toBe(MAX_UPLOAD_BODY_SIZE);
    });

    it('does not hand the allowance to the rest of the affiliate surface', () => {
        // The allowance is matched on METHOD + WHOLE PATH. A prefix match would give every admin
        // affiliate route an 8MB ceiling on a hook that runs before authentication.
        const others = [
            { method: 'POST', url: '/api/admin/affiliate/offers' },
            { method: 'PUT', url: '/api/admin/affiliate/offers/7' },
            { method: 'POST', url: '/api/admin/affiliate/partners' },
            { method: 'GET', url: '/api/admin/affiliate/offers/7/stats' },
            { method: 'GET', url: '/api/public/affiliate/offer' },
            { method: 'GET', url: '/api/public/affiliate/offers/7/go?l=p' },
        ];
        for (const request of others) {
            expect(resolveBodySizeLimit(request), request.url).toBe(MAX_BODY_SIZE);
        }
    });

    it('does not let a different method borrow the allowance', () => {
        expect(resolveBodySizeLimit({ method: 'PUT', url: '/api/admin/affiliate/offers/7/image' })).toBe(MAX_BODY_SIZE);
        expect(resolveBodySizeLimit({ method: 'GET', url: '/api/admin/affiliate/offers/7/image' })).toBe(MAX_BODY_SIZE);
        expect(resolveBodySizeLimit({ method: 'DELETE', url: '/api/admin/affiliate/offers/7/image' })).toBe(MAX_BODY_SIZE);
    });

    it('does not let a crafted path prefix or suffix borrow the allowance', () => {
        const crafted = [
            '/api/admin/affiliate/offers/7/image/../../cameras',
            '/api/admin/affiliate/offers/abc/image',
            '/api/admin/affiliate/offers//image',
            '/evil/api/admin/affiliate/offers/7/image',
            '/api/admin/affiliate/offers/7/imagex',
            '/api/affiliate/offers/7/image',
        ];
        for (const url of crafted) {
            expect(resolveBodySizeLimit({ method: 'POST', url }), url).toBe(MAX_BODY_SIZE);
        }
    });

    it('keeps the route ceiling BELOW the hook ceiling, so the route rejects first', () => {
        // The arithmetic routes/affiliateRoutes.js performs: base64 inflates by 4/3, plus a JSON
        // envelope. Recomputed here rather than imported, so a hand-edited literal in the route
        // that no longer follows from MAX_AFFILIATE_UPLOAD_BYTES is caught by the next assertion.
        const routeLimit = Math.ceil(MAX_AFFILIATE_UPLOAD_BYTES * 1.4) + 4096;

        expect(routeLimit).toBeLessThan(MAX_UPLOAD_BODY_SIZE);
        expect(routeLimit).toBeGreaterThan(MAX_AFFILIATE_UPLOAD_BYTES);
        expect(MAX_BODY_SIZE).toBeLessThan(MAX_AFFILIATE_UPLOAD_BYTES);
    });

    it('derives that route ceiling from the service constant instead of a literal', () => {
        const source = readFileSync(new URL('../routes/affiliateRoutes.js', import.meta.url), 'utf8');
        expect(source).toMatch(/MAX_AFFILIATE_UPLOAD_BYTES\s*\*\s*1\.4/);
        expect(source).toMatch(/bodyLimit/);
    });
});

describe('serving a real affiliate product photo', () => {
    it.each(AFF_FILES)('returns the actual bytes of %s', async (name) => {
        const response = await app.inject({ method: 'GET', url: `/api/affiliate-media/${name}` });

        // The promo-side regression produced NO response at all, so the status code is the first
        // thing that has to be right — a hang here reads as a timeout, not as a failed assertion.
        expect(response.statusCode).toBe(200);
        expect(response.rawPayload.equals(WEBP_BYTES)).toBe(true);
    });

    it('advertises it as an image, not as a download', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/affiliate-media/${AFF_FILES[0]}` });
        expect(response.headers['content-type']).toMatch(/image\/webp/);
    });

    it('is cacheable forever, since a replaced photo gets a new random filename', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/affiliate-media/${AFF_FILES[0]}` });
        const cacheControl = response.headers['cache-control'];

        expect(cacheControl).toMatch(/max-age=31536000/);
        expect(cacheControl).toMatch(/immutable/);
        expect(cacheControl).toMatch(/public/);
    });

    it('serves a HEAD request too', async () => {
        const response = await app.inject({ method: 'HEAD', url: `/api/affiliate-media/${AFF_FILES[0]}` });
        expect(response.statusCode).toBe(200);
    });
});

describe('the affiliate filename allowlist still holds when the files are real', () => {
    it('refuses a real file that is not a generated rendition', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/affiliate-media/${INTRUDER}` });
        expect(response.statusCode).toBe(404);
        expect(response.payload).not.toContain('do not serve me');
    });

    it.each([
        '../../../package.json',
        '..%2f..%2fpackage.json',
        `${AFF_BASE}-1200.webp`,
        `${AFF_BASE}.webp`,
        'aff-SHOUTING-320.webp',
        'promo-aaaabbbbccccdddd-1200.webp',
        '',
    ])('refuses %s', async (name) => {
        const response = await app.inject({ method: 'GET', url: `/api/affiliate-media/${name}` });
        expect(response.statusCode).toBe(404);
    });

    it('does not cache a refusal', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/affiliate-media/${INTRUDER}` });
        expect(response.headers['cache-control']).toBe('no-store');
    });

    it('a query string does not smuggle a bad name past the allowlist', async () => {
        const ok = await app.inject({ method: 'GET', url: `/api/affiliate-media/${AFF_FILES[0]}?v=2` });
        expect(ok.statusCode).toBe(200);

        const bad = await app.inject({
            method: 'GET',
            url: `/api/affiliate-media/${INTRUDER}?x=${AFF_FILES[0]}`,
        });
        expect(bad.statusCode).toBe(404);
    });
});
