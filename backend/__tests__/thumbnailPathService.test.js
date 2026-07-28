import { describe, expect, it } from 'vitest';
import { basename } from 'path';

import {
    createThumbnailExistenceChecker,
    resolveThumbnailFilePath,
    sanitizeCameraThumbnail,
    sanitizeCameraThumbnailList,
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

    it('sanitizes a whole list with a single shared existence check (honours caller fileExists)', () => {
        const checked = [];
        // Match the FILENAME, not the whole path: `filePath.includes('7')` also matched the
        // absolute checkout path, so this test failed in any working directory whose name
        // happened to contain a "7" (e.g. a temp dir named after a UUID).
        const fileExists = (filePath) => {
            checked.push(filePath);
            return basename(filePath) === '7.jpg';
        };

        const out = sanitizeCameraThumbnailList(
            [
                { id: 7, thumbnail_path: '/api/thumbnails/7.jpg', name: 'A' },
                { id: 8, thumbnail_path: '/api/thumbnails/8.jpg', name: 'B' },
                { id: 9, thumbnail_path: 'https://cdn.example.com/9.jpg', name: 'C' },
            ],
            fileExists
        );

        expect(out[0].thumbnail_path).toBe('/api/thumbnails/7.jpg');
        expect(out[1].thumbnail_path).toBeNull();
        // http(s) thumbnails never consult the filesystem checker.
        expect(out[2].thumbnail_path).toBe('https://cdn.example.com/9.jpg');
        expect(checked).toHaveLength(2);
    });

    it('returns an empty array for non-array input', () => {
        expect(sanitizeCameraThumbnailList(null)).toEqual([]);
        expect(sanitizeCameraThumbnailList(undefined)).toEqual([]);
    });

    it('createThumbnailExistenceChecker returns a callable checker that keeps http(s) thumbnails', () => {
        const checker = createThumbnailExistenceChecker();
        expect(typeof checker).toBe('function');
        // Directly-called http(s) paths are treated as existing (safety short-circuit).
        expect(checker('https://cdn.example.com/thumb.jpg')).toBe(true);
        expect(checker(null)).toBe(false);
    });
});
