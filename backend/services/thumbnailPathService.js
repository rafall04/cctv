import { existsSync } from 'fs';
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

export function sanitizeCameraThumbnailList(cameras, fileExists = existsSync) {
    return Array.isArray(cameras)
        ? cameras.map((camera) => sanitizeCameraThumbnail(camera, fileExists))
        : [];
}
