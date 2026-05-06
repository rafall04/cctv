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
    it('defines app shortcuts for core public and admin workflows', () => {
        const manifest = JSON.parse(fs.readFileSync(publicAssetPath('site.webmanifest'), 'utf8'));

        expect(manifest.display).toBe('standalone');
        expect(manifest.shortcuts).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'Peta CCTV', url: '/?view=map' }),
            expect.objectContaining({ name: 'Grid CCTV', url: '/?view=grid' }),
            expect.objectContaining({ name: 'Playback', url: '/playback' }),
            expect.objectContaining({ name: 'Admin Dashboard', url: '/admin/dashboard' }),
            expect.objectContaining({ name: 'Kamera Admin', url: '/admin/cameras' }),
            expect.objectContaining({ name: 'Health CCTV', url: '/admin/health-debug' }),
        ]));
    });

    it('contains an offline app-shell fallback in the service worker', () => {
        const serviceWorker = fs.readFileSync(publicAssetPath('sw.js'), 'utf8');

        expect(serviceWorker).toContain('RAFNET_CCTV_CACHE');
        expect(serviceWorker).toContain('offlineFallback');
        expect(serviceWorker).toContain('event.respondWith');
    });
});
