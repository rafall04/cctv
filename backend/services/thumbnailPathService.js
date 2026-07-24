import { existsSync, readdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const THUMBNAIL_PREFIX = '/api/thumbnails/';
const THUMBNAIL_DIR = join(__dirname, '..', 'data', 'thumbnails');

export function resolveThumbnailFilePath(thumbnailPath) {
    if (!thumbnailPath || typeof thumbnailPath !== 'string') {
        return null;
    }

    if (/^https?:\/\//i.test(thumbnailPath)) {
        return thumbnailPath;
    }

    if (!thumbnailPath.startsWith(THUMBNAIL_PREFIX)) {
        return null;
    }

    const filename = basename(thumbnailPath.split('?')[0]);
    if (!filename) {
        return null;
    }

    return join(THUMBNAIL_DIR, filename);
}

export function sanitizeThumbnailPath(thumbnailPath, fileExists = existsSync) {
    if (!thumbnailPath) {
        return null;
    }

    if (/^https?:\/\//i.test(thumbnailPath)) {
        return thumbnailPath;
    }

    const filePath = resolveThumbnailFilePath(thumbnailPath);
    if (!filePath) {
        return null;
    }

    return fileExists(filePath) ? thumbnailPath : null;
}

export function sanitizeCameraThumbnail(camera, fileExists = existsSync) {
    if (!camera) {
        return camera;
    }

    return {
        ...camera,
        thumbnail_path: sanitizeThumbnailPath(camera.thumbnail_path, fileExists),
    };
}

/**
 * Build an O(1) thumbnail-existence checker by listing THUMBNAIL_DIR ONCE.
 *
 * The public/admin camera-list rebuild used to run one blocking `existsSync()` per
 * camera to hide missing thumbnails — up to ~749 serial `stat()` syscalls that stalled
 * the event loop for seconds on the disk-contended prod box (the root cause of the ~4s
 * `GET /api/cameras/active`). A single `readdirSync` + Set membership replaces all of
 * them and stops blocking every other request during the rebuild.
 *
 * Falls back to per-file `existsSync` when the directory can't be listed (missing dir on
 * a fresh deploy, test env, etc.), so behaviour is unchanged in those cases.
 */
export function createThumbnailExistenceChecker() {
    let names;
    try {
        names = new Set(readdirSync(THUMBNAIL_DIR));
    } catch {
        return existsSync;
    }

    return (filePath) => {
        if (typeof filePath !== 'string') {
            return false;
        }
        // http(s) thumbnails short-circuit before this checker is consulted; stay safe if
        // it is ever called with one directly.
        if (/^https?:\/\//i.test(filePath)) {
            return true;
        }
        return names.has(basename(filePath));
    };
}

export function sanitizeCameraThumbnailList(cameras, fileExists) {
    if (!Array.isArray(cameras)) {
        return [];
    }

    // Read the thumbnail directory once for the whole list instead of one existsSync per
    // camera. A caller-supplied fileExists (e.g. tests) is still honoured.
    const exists = fileExists || createThumbnailExistenceChecker();
    return cameras.map((camera) => sanitizeCameraThumbnail(camera, exists));
}
