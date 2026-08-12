/*
Purpose: Turn an uploaded promo poster into small, fixed-size WebP renditions on disk.
Caller: promoController (admin image upload/replace), promoBannerService (delete cleanup).
Deps: ffmpeg/ffprobe (already required by thumbnailService), backend/data/promos storage.
MainFuncs: savePromoImage, deletePromoImage, isSafeImageBase, promoImagePaths, PROMO_IMAGE_DIR.
SideEffects: Executes ffmpeg/ffprobe, writes and deletes files under backend/data/promos.
*/

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROMO_IMAGE_DIR = join(__dirname, '..', 'data', 'promos');

/*
 * Two renditions, both WebP. 1200px is enough for the widest place the poster is
 * ever shown (the popup detail column caps well below that) and 640px covers
 * phones at 2x DPR without shipping them the desktop file. The public component
 * picks between them with `srcset`, so a phone downloads roughly a quarter of
 * the desktop bytes.
 */
export const PROMO_RENDITIONS = [
    { key: '1200', width: 1200 },
    { key: '640', width: 640 },
];
const PRIMARY_RENDITION = PROMO_RENDITIONS[0];

// Quality 82 with compression_level 6 is the knee of the curve for photographic
// posters: visually indistinguishable from the source at 1200px, typically an
// order of magnitude smaller than the PNG an operator exports from a design tool.
const WEBP_QUALITY = '82';
const WEBP_COMPRESSION_LEVEL = '6';
const FFMPEG_TIMEOUT_MS = 20000;

export const MAX_PROMO_UPLOAD_BYTES = 5 * 1024 * 1024;

/*
 * Magic-byte allowlist. The upload arrives as base64 in a JSON body, so the
 * declared filename and content-type are both attacker-controlled and worthless
 * — the leading bytes are the only trustworthy signal about what we were handed.
 * ffmpeg is then asked to re-encode it, which is what actually guarantees the
 * stored file is a real image and not a polyglot carrying something else.
 */
const MAGIC_SIGNATURES = [
    { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
];

function detectImageKind(buffer) {
    for (const sig of MAGIC_SIGNATURES) {
        if (buffer.length >= sig.bytes.length && sig.bytes.every((b, i) => buffer[i] === b)) {
            return sig.ext;
        }
    }
    // WebP is RIFF-wrapped: "RIFF" .... "WEBP"
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        return 'webp';
    }
    return null;
}

/**
 * Guard for every filesystem path built from a stored `image_base`.
 * Nothing outside this alphabet can reach `join()`, so a doctored DB value or a
 * hand-edited request can never walk out of PROMO_IMAGE_DIR.
 */
export function isSafeImageBase(imageBase) {
    return typeof imageBase === 'string' && /^promo-[a-z0-9]{6,40}$/.test(imageBase);
}

/**
 * Absolute on-disk paths for every rendition of one image base.
 */
export function promoImagePaths(imageBase) {
    if (!isSafeImageBase(imageBase)) {
        return [];
    }
    return PROMO_RENDITIONS.map((r) => join(PROMO_IMAGE_DIR, `${imageBase}-${r.key}.webp`));
}

/**
 * Create the storage directory if absent. Also called from server boot, because
 * @fastify/static refuses to register against a root that does not exist.
 */
export function ensurePromoImageDir() {
    if (!existsSync(PROMO_IMAGE_DIR)) {
        mkdirSync(PROMO_IMAGE_DIR, { recursive: true });
        console.log('[Promo] Created image directory:', PROMO_IMAGE_DIR);
    }
    return PROMO_IMAGE_DIR;
}
const ensureDir = ensurePromoImageDir;

/**
 * Filenames this feature is allowed to serve. Anything else 404s before it can
 * reach the static handler.
 */
export const PROMO_MEDIA_FILENAME_RE = new RegExp(
    `^promo-[a-z0-9]{6,40}-(${PROMO_RENDITIONS.map((r) => r.key).join('|')})\\.webp$`
);

async function probeDimensions(filePath) {
    const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0',
        filePath,
    ], { timeout: FFMPEG_TIMEOUT_MS });

    const [width, height] = String(stdout).trim().split(',').map((n) => parseInt(n, 10));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        const err = new Error('Gambar tidak dapat dibaca (format tidak dikenali)');
        err.statusCode = 400;
        throw err;
    }
    return { width, height };
}

/**
 * Decode + validate an uploaded poster and write its WebP renditions.
 *
 * @param {Buffer} buffer - Raw decoded upload bytes.
 * @returns {Promise<{imageBase: string, width: number, height: number, bytes: number, renditions: Array}>}
 */
export async function savePromoImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        const err = new Error('Berkas gambar kosong');
        err.statusCode = 400;
        throw err;
    }
    if (buffer.length > MAX_PROMO_UPLOAD_BYTES) {
        const err = new Error(`Ukuran gambar melebihi ${Math.round(MAX_PROMO_UPLOAD_BYTES / (1024 * 1024))}MB`);
        err.statusCode = 413;
        throw err;
    }

    const kind = detectImageKind(buffer);
    if (!kind) {
        const err = new Error('Format tidak didukung. Gunakan PNG, JPG, atau WebP.');
        err.statusCode = 400;
        throw err;
    }

    ensureDir();

    const imageBase = `promo-${randomBytes(8).toString('hex')}`;
    const tempPath = join(PROMO_IMAGE_DIR, `.upload-${imageBase}.${kind}`);
    const written = [];

    try {
        writeFileSync(tempPath, buffer);
        const source = await probeDimensions(tempPath);

        for (const rendition of PROMO_RENDITIONS) {
            const outPath = join(PROMO_IMAGE_DIR, `${imageBase}-${rendition.key}.webp`);
            // Never upscale: a small source stays its own size rather than being
            // blown up into a bigger, blurrier file.
            const targetWidth = Math.min(rendition.width, source.width);
            // Width computed here as a plain integer on purpose — passing an
            // ffmpeg `min()` expression would need comma-escaping inside the
            // filtergraph, which is exactly the kind of quoting that breaks
            // silently when there is no shell to do it.
            await execFileAsync('ffmpeg', [
                '-y',
                '-i', tempPath,
                '-vf', `scale=${targetWidth}:-2`,
                '-map_metadata', '-1',
                '-frames:v', '1',
                '-an',
                '-c:v', 'libwebp',
                '-quality', WEBP_QUALITY,
                '-compression_level', WEBP_COMPRESSION_LEVEL,
                '-preset', 'picture',
                outPath,
            ], { timeout: FFMPEG_TIMEOUT_MS });

            if (!existsSync(outPath)) {
                throw new Error(`ffmpeg tidak menghasilkan berkas untuk rendition ${rendition.key}`);
            }
            written.push({ key: rendition.key, path: outPath, bytes: statSync(outPath).size });
        }

        const primary = written.find((w) => w.key === PRIMARY_RENDITION.key);
        const scale = Math.min(PRIMARY_RENDITION.width, source.width) / source.width;

        console.log(
            `[Promo] Encoded ${imageBase}: ${kind} ${source.width}x${source.height} ${Math.round(buffer.length / 1024)}KB -> ` +
            written.map((w) => `${w.key}=${Math.round(w.bytes / 1024)}KB`).join(' ')
        );

        return {
            imageBase,
            width: Math.round(source.width * scale),
            height: Math.round(source.height * scale),
            bytes: primary ? primary.bytes : null,
            sourceBytes: buffer.length,
            renditions: written.map((w) => ({ key: w.key, bytes: w.bytes })),
        };
    } catch (error) {
        // Never leave half a set behind — a banner with one rendition would 404
        // for whichever viewport asked for the missing one.
        for (const w of written) {
            try { unlinkSync(w.path); } catch { /* already gone */ }
        }
        if (error.statusCode) {
            throw error;
        }
        console.error('[Promo] Image encode failed:', error.message);
        const err = new Error('Gagal memproses gambar');
        err.statusCode = 500;
        throw err;
    } finally {
        try { unlinkSync(tempPath); } catch { /* never written, or already gone */ }
    }
}

/**
 * Remove every rendition of an image base. Missing files are not an error —
 * this runs on banner delete and on image replace, and either may race.
 */
export function deletePromoImage(imageBase) {
    let removed = 0;
    for (const path of promoImagePaths(imageBase)) {
        try {
            unlinkSync(path);
            removed += 1;
        } catch { /* already gone */ }
    }
    return removed;
}

export default {
    PROMO_IMAGE_DIR,
    PROMO_RENDITIONS,
    PROMO_MEDIA_FILENAME_RE,
    MAX_PROMO_UPLOAD_BYTES,
    ensurePromoImageDir,
    savePromoImage,
    deletePromoImage,
    promoImagePaths,
    isSafeImageBase,
};
