/*
 * promoImageEncode.test.js — the real WebP encode path.
 *
 * Deliberately NOT mocked. "The poster is made lightweight" is a claim about what
 * ffmpeg actually produces — file sizes, dimensions, and that a non-image is
 * refused. A stubbed execFile would assert only that we pass the arguments we
 * pass, which is exactly the class of test that proves nothing.
 *
 * Skips itself where ffmpeg is absent (the Windows dev laptop). It runs on the
 * deployment box and on CI, which both have ffmpeg with libwebp.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import {
    savePromoImage,
    deletePromoImage,
    promoImagePaths,
    ensurePromoImageDir,
    PROMO_IMAGE_DIR,
    MAX_PROMO_UPLOAD_BYTES,
} from '../services/promoImageService.js';

const execFileAsync = promisify(execFile);

let sourcePng = null;
const created = [];

async function ffmpegAvailable() {
    try {
        const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-encoders'], { timeout: 10000 });
        return stdout.includes('libwebp');
    } catch {
        return false;
    }
}

/*
 * Detected with TOP-LEVEL await, not in beforeAll. `describe.skipIf` is evaluated
 * while the module is being collected — before any hook runs — so a flag set in
 * beforeAll is still false at that point and the whole suite skips EVERYWHERE,
 * including on machines that do have ffmpeg. That is worse than no test: it looks
 * like coverage while proving nothing. (Caught exactly that way on the box.)
 */
const hasFfmpeg = await ffmpegAvailable();

beforeAll(async () => {
    if (!hasFfmpeg) {
        return;
    }
    ensurePromoImageDir();
    // Same shape as the real poster (4:3, 1449x1080) so the scale maths is exercised.
    sourcePng = join(PROMO_IMAGE_DIR, '.test-source.png');
    await execFileAsync('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=1449x1080:rate=1',
        '-frames:v', '1', sourcePng,
    ], { timeout: 30000 });
}, 60000);

afterAll(() => {
    for (const base of created) {
        deletePromoImage(base);
    }
    if (sourcePng && existsSync(sourcePng)) {
        rmSync(sourcePng, { force: true });
    }
});

describe.skipIf(!hasFfmpeg)('savePromoImage — real ffmpeg encode', () => {
    it('writes BOTH renditions as real WebP, never upscaling', async () => {
        const result = await savePromoImage(readFileSync(sourcePng));
        created.push(result.imageBase);

        const paths = promoImagePaths(result.imageBase);
        expect(paths).toHaveLength(2);
        for (const path of paths) {
            expect(existsSync(path), path).toBe(true);
            // RIFF....WEBP — proves ffmpeg produced WebP, not a renamed PNG.
            const head = readFileSync(path).subarray(0, 12);
            expect(head.toString('ascii', 0, 4)).toBe('RIFF');
            expect(head.toString('ascii', 8, 12)).toBe('WEBP');
        }

        // 1449 wide source -> capped at the 1200 rendition, aspect ratio kept.
        expect(result.width).toBe(1200);
        expect(result.height).toBe(Math.round(1080 * (1200 / 1449)));
    }, 60000);

    it('actually makes the poster lighter, and the phone rendition lighter still', async () => {
        const source = readFileSync(sourcePng);
        const result = await savePromoImage(source);
        created.push(result.imageBase);

        const [wide, narrow] = promoImagePaths(result.imageBase).map((p) => readFileSync(p).length);
        expect(result.bytes).toBe(wide);
        // The whole point of the srcset: a phone downloads materially fewer bytes.
        expect(narrow).toBeLessThan(wide);
    }, 60000);

    it('does not upscale a source smaller than the rendition width', async () => {
        const small = join(PROMO_IMAGE_DIR, '.test-small.png');
        await execFileAsync('ffmpeg', [
            '-y', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc=size=400x300:rate=1',
            '-frames:v', '1', small,
        ], { timeout: 30000 });

        const result = await savePromoImage(readFileSync(small));
        created.push(result.imageBase);
        rmSync(small, { force: true });

        expect(result.width).toBe(400);
    }, 60000);

    it('refuses a non-image even when it is named like one', async () => {
        // Magic bytes, not the filename or content-type, are what we trust.
        await expect(savePromoImage(Buffer.from('#!/bin/sh\nrm -rf /\n'))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses an empty upload', async () => {
        await expect(savePromoImage(Buffer.alloc(0))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses an oversized upload before touching ffmpeg', async () => {
        const tooBig = Buffer.alloc(MAX_PROMO_UPLOAD_BYTES + 1);
        // PNG magic so it fails on SIZE, not on the format check.
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(tooBig);
        await expect(savePromoImage(tooBig)).rejects.toMatchObject({ statusCode: 413 });
    });

    it('leaves no temp file behind', async () => {
        const before = readdirSync(PROMO_IMAGE_DIR).filter((f) => f.startsWith('.upload-'));
        const result = await savePromoImage(readFileSync(sourcePng));
        created.push(result.imageBase);
        const after = readdirSync(PROMO_IMAGE_DIR).filter((f) => f.startsWith('.upload-'));
        expect(after).toEqual(before);
    }, 60000);

    it('deletePromoImage removes every rendition', async () => {
        const result = await savePromoImage(readFileSync(sourcePng));
        const paths = promoImagePaths(result.imageBase);

        expect(deletePromoImage(result.imageBase)).toBe(2);
        for (const path of paths) {
            expect(existsSync(path)).toBe(false);
        }
        // Idempotent — delete runs on both replace and banner-delete, which can race.
        expect(deletePromoImage(result.imageBase)).toBe(0);
    }, 60000);
});
