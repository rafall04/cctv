/*
 * Purpose: Verify public/admin PWA manifest and service worker assets are installable and app-shell friendly.
 * Caller: Frontend focused PWA asset test gate.
 * Deps: fs, Vitest, frontend/public assets.
 * MainFuncs: PWA manifest and service worker checks.
 * SideEffects: Reads static public assets.
 */

import fs from 'fs';
import { describe, expect, it } from 'vitest';

const publicAssetPath = (filename) => `public/${filename}`;

describe('PWA public assets', () => {
    /*
     * Admin shortcuts used to live in the PUBLIC manifest, because there was only one manifest.
     * They moved to admin.webmanifest when admin became its own installable app — a shortcut
     * outside a manifest's own scope opens in a browser tab rather than in the app, so mixing
     * them defeated both.
     */
    it('the public manifest offers public shortcuts, and no admin ones', () => {
        const manifest = JSON.parse(fs.readFileSync(publicAssetPath('site.webmanifest'), 'utf8'));

        expect(manifest.display).toBe('standalone');
        expect(manifest.shortcuts).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'Peta CCTV', url: '/?view=map' }),
            expect.objectContaining({ name: 'Grid CCTV', url: '/?view=grid' }),
            expect.objectContaining({ name: 'Playback', url: '/playback' }),
        ]));
        expect(manifest.shortcuts.filter((s) => s.url.startsWith('/admin'))).toEqual([]);
    });

    it('the admin manifest is a separate installable app with its own shortcuts', () => {
        const manifest = JSON.parse(fs.readFileSync(publicAssetPath('admin.webmanifest'), 'utf8'));

        expect(manifest.display).toBe('standalone');
        expect(manifest.start_url).toBe('/admin/dashboard');
        expect(manifest.shortcuts).toEqual(expect.arrayContaining([
            expect.objectContaining({ url: '/admin/cameras' }),
            expect.objectContaining({ url: '/admin/health-debug' }),
        ]));
    });

    it('contains an offline app-shell fallback in the service worker', () => {
        const serviceWorker = fs.readFileSync(publicAssetPath('sw.js'), 'utf8');

        expect(serviceWorker).toContain('RAFNET_CCTV_CACHE');
        expect(serviceWorker).toContain('offlineFallback');
        expect(serviceWorker).toContain('event.respondWith');
    });
});
