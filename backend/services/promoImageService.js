/*
Purpose: Turn an uploaded image into small, fixed-size WebP renditions on disk — the promo poster
         this was built for, and now any other feature that needs the same pipeline.
Caller: promoBannerController (poster upload/replace), promoBannerService (delete cleanup),
        promoMediaRoutes; affiliate offer photos via AFFILIATE_IMAGE_OPTIONS.
Deps: ffmpeg/ffprobe (already required by thumbnailService), backend/data/<feature> storage.
MainFuncs: savePromoImage, deletePromoImage, isSafeImageBase, promoImagePaths, ensurePromoImageDir,
           buildMediaFilenameRe, PROMO_IMAGE_OPTIONS, AFFILIATE_IMAGE_OPTIONS.
SideEffects: Executes ffmpeg/ffprobe, writes and deletes files under backend/data/<feature>.

WHY THIS FILE WAS GENERALISED INSTEAD OF COPIED
-----------------------------------------------
The affiliate product photo needs exactly what the promo poster needs: magic-byte sniffing, an
ffmpeg re-encode (which is the thing that actually proves the bytes are an image and not a
polyglot), fixed renditions, a "never leave half a set behind" cleanup, and a filename allowlist
guarding every path built from a DB value. A second copy of that would be two places to apply the
next hardening — and the copy always gets fixed second, quietly, or never. So every entry point
takes an OPTIONS object and the DEFAULTS are the promo values: called the old one-argument way,
this file behaves byte-for-byte as it did before, which is what keeps the promo path honest.

WHAT AN OPTIONS OBJECT MAY CHANGE, AND WHAT IT MAY NOT
------------------------------------------------------
Changeable, because they are properties of WHERE the image is shown: the storage directory, the
rendition list, the filename prefix, the upload ceiling, the log label.
NOT changeable, because they are the safety and quality properties: the magic-byte allowlist, the
re-encode itself, the WebP settings, the no-upscaling rule, the timeout. A caller that could opt
out of those is a caller that eventually does.

WHY THE AFFILIATE RENDITIONS ARE SO MUCH SMALLER
-------------------------------------------------
A promo poster is the widest thing in the popup's detail column, hence 1200/640. An affiliate
product photo is a thumbnail on a card that is at most ~320 CSS px wide on a phone, so 320/160
covers 1x and 2x without shipping a poster under every live camera. Sizing belongs to the
placement, which is precisely why renditions are per-feature and not a module constant.

WHY THE PREFIX IS VALIDATED BEFORE IT REACHES A RegExp
-------------------------------------------------------
`isSafeImageBase` and the media filename allowlist are both built by interpolating the prefix into
a pattern, and those two regexes are the whole defence against a doctored `image_base` walking out
of the storage directory. So the prefix is constrained to `[a-z0-9]+-` up front: no dots, no
slashes, no quantifiers, nothing that could turn an allowlist into a wildcard.
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
export const AFFILIATE_IMAGE_DIR = join(__dirname, '..', 'data', 'affiliate');

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

/*
 * The affiliate card's photo, at 1x and 2x of its widest layout. Same `srcset` trick, an order of
 * magnitude fewer bytes — this one loads under a LIVE VIDEO on a phone, so every kilobyte competes
 * with the stream for the same bandwidth.
 */
export const AFFILIATE_RENDITIONS = [
    { key: '320', width: 320 },
    { key: '160', width: 160 },
];

// Quality 82 with compression_level 6 is the knee of the curve for photographic
// posters: visually indistinguishable from the source at 1200px, typically an
// order of magnitude smaller than the PNG an operator exports from a design tool.
const WEBP_QUALITY = '82';
const WEBP_COMPRESSION_LEVEL = '6';
const FFMPEG_TIMEOUT_MS = 20000;

export const MAX_PROMO_UPLOAD_BYTES = 5 * 1024 * 1024;
/*
 * Deliberately the SAME ceiling as the poster even though the output is tiny: what an operator
 * uploads is a photo straight off a phone, and the limit applies to the SOURCE. Two different
 * numbers would also mean two different body limits to keep in sync (inputSanitizer's
 * LARGE_BODY_ROUTES and the route's own bodyLimit), and that pair drifting is how an upload
 * starts failing with a Fastify 413 that never reaches this file's Indonesian error message.
 */
export const MAX_AFFILIATE_UPLOAD_BYTES = MAX_PROMO_UPLOAD_BYTES;

/** The defaults. Passing no options anywhere in this file means exactly these values. */
export const PROMO_IMAGE_OPTIONS = Object.freeze({
    dir: PROMO_IMAGE_DIR,
    renditions: PROMO_RENDITIONS,
    prefix: 'promo-',
    label: 'Promo',
    maxBytes: MAX_PROMO_UPLOAD_BYTES,
});

/** What the affiliate side passes to every function here. */
export const AFFILIATE_IMAGE_OPTIONS = Object.freeze({
    dir: AFFILIATE_IMAGE_DIR,
    renditions: AFFILIATE_RENDITIONS,
    prefix: 'aff-',
    label: 'Affiliate',
    maxBytes: MAX_AFFILIATE_UPLOAD_BYTES,
});

// Lowercase alphanumerics then one trailing dash. See the header for why this is enforced.
const SAFE_PREFIX_RE = /^[a-z0-9]+-$/;

function resolveImageOptions(options) {
    if (!options || options === PROMO_IMAGE_OPTIONS) {
        return PROMO_IMAGE_OPTIONS;
    }
    const merged = { ...PROMO_IMAGE_OPTIONS, ...options };
    if (!SAFE_PREFIX_RE.test(merged.prefix)) {
        throw new Error(`Prefiks nama berkas gambar tidak valid: ${merged.prefix}`);
    }
    if (!Array.isArray(merged.renditions) || merged.renditions.length === 0) {
        throw new Error('Daftar rendition gambar tidak boleh kosong');
    }
    return merged;
}

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
 * hand-edited request can never walk out of the feature's storage directory.
 *
 * @param {string} imageBase
 * @param {object} [options] - defaults to PROMO_IMAGE_OPTIONS
 */
export function isSafeImageBase(imageBase, options) {
    const { prefix } = resolveImageOptions(options);
    return typeof imageBase === 'string' && new RegExp(`^${prefix}[a-z0-9]{6,40}$`).test(imageBase);
}

/**
 * Absolute on-disk paths for every rendition of one image base.
 *
 * @param {string} imageBase
 * @param {object} [options] - defaults to PROMO_IMAGE_OPTIONS
 * @returns {string[]} empty when the base fails the allowlist — never a partial list
 */
export function promoImagePaths(imageBase, options) {
    const opts = resolveImageOptions(options);
    if (!isSafeImageBase(imageBase, opts)) {
        return [];
    }
    return opts.renditions.map((r) => join(opts.dir, `${imageBase}-${r.key}.webp`));
}

/**
 * Create the storage directory if absent. Also called from server boot and from the media route,
 * because @fastify/static refuses to register against a root that does not exist.
 *
 * @param {object} [options] - defaults to PROMO_IMAGE_OPTIONS
 * @returns {string} the directory
 */
export function ensurePromoImageDir(options) {
    const { dir, label } = resolveImageOptions(options);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        console.log(`[${label}] Created image directory:`, dir);
    }
    return dir;
}
const ensureDir = ensurePromoImageDir;

/**
 * Filenames a media route is allowed to serve. Anything else 404s before it can
 * reach the static handler.
 *
 * @param {object} [options] - defaults to PROMO_IMAGE_OPTIONS
 */
export function buildMediaFilenameRe(options) {
    const opts = resolveImageOptions(options);
    return new RegExp(`^${opts.prefix}[a-z0-9]{6,40}-(${opts.renditions.map((r) => r.key).join('|')})\\.webp$`);
}

export const PROMO_MEDIA_FILENAME_RE = buildMediaFilenameRe(PROMO_IMAGE_OPTIONS);
export const AFFILIATE_MEDIA_FILENAME_RE = buildMediaFilenameRe(AFFILIATE_IMAGE_OPTIONS);

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
 * Decode + validate an uploaded image and write its WebP renditions.
 *
 * @param {Buffer} buffer - Raw decoded upload bytes.
 * @param {object} [options] - defaults to PROMO_IMAGE_OPTIONS (promo dir, 1200/640, `promo-`).
 * @returns {Promise<{imageBase: string, width: number, height: number, bytes: number, renditions: Array}>}
 */
export async function savePromoImage(buffer, options) {
    const opts = resolveImageOptions(options);
    const primaryRendition = opts.renditions[0];

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        const err = new Error('Berkas gambar kosong');
        err.statusCode = 400;
        throw err;
    }
    if (buffer.length > opts.maxBytes) {
        const err = new Error(`Ukuran gambar melebihi ${Math.round(opts.maxBytes / (1024 * 1024))}MB`);
        err.statusCode = 413;
        throw err;
    }

    const kind = detectImageKind(buffer);
    if (!kind) {
        const err = new Error('Format tidak didukung. Gunakan PNG, JPG, atau WebP.');
        err.statusCode = 400;
        throw err;
    }

    ensureDir(opts);

    const imageBase = `${opts.prefix}${randomBytes(8).toString('hex')}`;
    const tempPath = join(opts.dir, `.upload-${imageBase}.${kind}`);
    const written = [];

    try {
        writeFileSync(tempPath, buffer);
        const source = await probeDimensions(tempPath);

        for (const rendition of opts.renditions) {
            const outPath = join(opts.dir, `${imageBase}-${rendition.key}.webp`);
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

        const primary = written.find((w) => w.key === primaryRendition.key);
        const scale = Math.min(primaryRendition.width, source.width) / source.width;

        console.log(
            `[${opts.label}] Encoded ${imageBase}: ${kind} ${source.width}x${source.height} ${Math.round(buffer.length / 1024)}KB -> ` +
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
        // Never leave half a set behind — a card with one rendition would 404
        // for whichever viewport asked for the missing one.
        for (const w of written) {
            try { unlinkSync(w.path); } catch { /* already gone */ }
        }
        if (error.statusCode) {
            throw error;
        }
        console.error(`[${opts.label}] Image encode failed:`, error.message);
        const err = new Error('Gagal memproses gambar');
        err.statusCode = 500;
        throw err;
    } finally {
        try { unlinkSync(tempPath); } catch { /* never written, or already gone */ }
    }
}

/**
 * Remove every rendition of an image base. Missing files are not an error —
 * this runs on delete and on image replace, and either may race.
 *
 * @param {string} imageBase
 * @param {object} [options] - MUST be the same options the base was written with; a promo base
 *                             looked up with affiliate options simply fails the allowlist and
 *                             removes nothing, which is the safe direction to fail in.
 * @returns {number} how many files were actually unlinked
 */
export function deletePromoImage(imageBase, options) {
    let removed = 0;
    for (const path of promoImagePaths(imageBase, options)) {
        try {
            unlinkSync(path);
            removed += 1;
        } catch { /* already gone */ }
    }
    return removed;
}

export default {
    PROMO_IMAGE_DIR,
    AFFILIATE_IMAGE_DIR,
    PROMO_RENDITIONS,
    AFFILIATE_RENDITIONS,
    PROMO_IMAGE_OPTIONS,
    AFFILIATE_IMAGE_OPTIONS,
    PROMO_MEDIA_FILENAME_RE,
    AFFILIATE_MEDIA_FILENAME_RE,
    MAX_PROMO_UPLOAD_BYTES,
    MAX_AFFILIATE_UPLOAD_BYTES,
    buildMediaFilenameRe,
    ensurePromoImageDir,
    savePromoImage,
    deletePromoImage,
    promoImagePaths,
    isSafeImageBase,
};
