/*
 * promoMediaRoutes.test.js — actually SERVE a poster through a real Fastify.
 *
 * Earned in production. The route was verified only against filenames that did not
 * exist, which 404 before the file-serving path is ever reached, and the allowlist
 * unit tests never touched Fastify at all. So a `setHeaders` callback written
 * against the Node `res` API — while @fastify/static calls it with a Fastify Reply
 * — shipped green. Every real poster request then HUNG (the callback threw inside
 * the send pump, after the route had matched, so no reply was ever sent) and the
 * banner silently never appeared.
 *
 * Hence: a real Fastify instance, a real file on disk, asserting on the BYTES.
 * A mock cannot prove this.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import promoMediaRoutes from '../routes/promoMediaRoutes.js';
import { PROMO_IMAGE_DIR, ensurePromoImageDir } from '../services/promoImageService.js';

// A real (tiny) WebP: "RIFF" + size + "WEBP" + a VP8L payload.
const WEBP_BYTES = Buffer.from(
    'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
    'base64'
);

const BASE = 'promo-aaaabbbbccccdddd';
const FILES = [`${BASE}-1200.webp`, `${BASE}-640.webp`];

let app;

beforeAll(async () => {
    ensurePromoImageDir();
    mkdirSync(PROMO_IMAGE_DIR, { recursive: true });
    for (const name of FILES) {
        writeFileSync(join(PROMO_IMAGE_DIR, name), WEBP_BYTES);
    }
    // Also drop a file the allowlist must refuse, next to the real ones.
    writeFileSync(join(PROMO_IMAGE_DIR, 'secret.txt'), 'do not serve me');

    app = Fastify();
    await app.register(promoMediaRoutes);
    await app.ready();
});

afterAll(async () => {
    if (app) await app.close();
    for (const name of [...FILES, 'secret.txt']) {
        const path = join(PROMO_IMAGE_DIR, name);
        if (existsSync(path)) rmSync(path, { force: true });
    }
});

describe('serving a real poster', () => {
    it.each(FILES)('returns the actual bytes of %s', async (name) => {
        const response = await app.inject({ method: 'GET', url: `/api/promo-media/${name}` });

        // The regression produced no response at all, so status is the first thing
        // that has to be right.
        expect(response.statusCode).toBe(200);
        expect(response.rawPayload.equals(WEBP_BYTES)).toBe(true);
    });

    it('advertises it as an image, not as a download', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/promo-media/${FILES[0]}` });
        expect(response.headers['content-type']).toMatch(/image\/webp/);
    });

    it('is cacheable forever, since a replaced poster gets a new filename', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/promo-media/${FILES[0]}` });
        const cacheControl = response.headers['cache-control'];

        expect(cacheControl).toMatch(/max-age=31536000/);
        expect(cacheControl).toMatch(/immutable/);
        expect(cacheControl).toMatch(/public/);
    });

    it('serves a HEAD request too', async () => {
        const response = await app.inject({ method: 'HEAD', url: `/api/promo-media/${FILES[0]}` });
        expect(response.statusCode).toBe(200);
    });
});

describe('the filename allowlist still holds when the files are real', () => {
    it('refuses a real file that is not a generated rendition', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/promo-media/secret.txt' });
        expect(response.statusCode).toBe(404);
        expect(response.payload).not.toContain('do not serve me');
    });

    it.each([
        '../../../package.json',
        '..%2f..%2fpackage.json',
        `${BASE}-999.webp`,
        `${BASE}.webp`,
        'promo-SHOUTING-1200.webp',
        '',
    ])('refuses %s', async (name) => {
        const response = await app.inject({ method: 'GET', url: `/api/promo-media/${name}` });
        expect(response.statusCode).toBe(404);
    });

    it('does not cache a refusal', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/promo-media/secret.txt' });
        expect(response.headers['cache-control']).toBe('no-store');
    });

    it('a query string does not smuggle a bad name past the allowlist', async () => {
        const ok = await app.inject({ method: 'GET', url: `/api/promo-media/${FILES[0]}?v=2` });
        expect(ok.statusCode).toBe(200);

        const bad = await app.inject({ method: 'GET', url: '/api/promo-media/secret.txt?x=promo-aaaabbbbcccc-1200.webp' });
        expect(bad.statusCode).toBe(404);
    });
});
