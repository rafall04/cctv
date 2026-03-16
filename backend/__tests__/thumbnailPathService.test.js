import { describe, expect, it } from 'vitest';

import {
    resolveThumbnailFilePath,
    sanitizeCameraThumbnail,
    sanitizeThumbnailPath,
} from '../services/thumbnailPathService.js';

describe('thumbnailPathService', () => {
    it('preserves a relative thumbnail path when the file exists', () => {
        expect(sanitizeThumbnailPath('/api/thumbnails/12.jpg', () => true)).toBe('/api/thumbnails/12.jpg');
    });

    it('returns null when the referenced thumbnail file does not exist', () => {
        expect(sanitizeThumbnailPath('/api/thumbnails/12.jpg', () => false)).toBeNull();
    });

    it('returns null for unsupported thumbnail path formats', () => {
        expect(sanitizeThumbnailPath('/uploads/12.jpg', () => true)).toBeNull();
    });

    it('keeps absolute thumbnail URLs untouched', () => {
        expect(sanitizeThumbnailPath('https://cdn.example.com/thumb.jpg', () => false)).toBe('https://cdn.example.com/thumb.jpg');
    });

    it('sanitizes camera payloads by nulling missing thumbnail files', () => {
        expect(
            sanitizeCameraThumbnail(
                { id: 7, thumbnail_path: '/api/thumbnails/7.jpg', name: 'Lobby' },
                () => false
            )
        ).toMatchObject({
            id: 7,
            thumbnail_path: null,
        });
    });

    it('resolves thumbnail file paths inside the backend thumbnail directory', () => {
        const resolved = resolveThumbnailFilePath('/api/thumbnails/18.jpg');
        expect(resolved).toContain('backend');
        expect(resolved).toContain('data');
        expect(resolved).toContain('thumbnails');
        expect(resolved).toContain('18.jpg');
    });
});
