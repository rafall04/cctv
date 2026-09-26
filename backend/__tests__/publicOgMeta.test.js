/**
 * Purpose: Verify the SSI Open Graph fragment endpoint — crawlers (WA/TG/FB) read only the
 *          served HTML, so share links must carry camera/area-specific meta server-side.
 * Caller: Backend focused route test gate.
 * Deps: Fastify, vitest; cameraService/areaService/publicGrowthService/brandingService mocks.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getPublicLandingCameraListMock,
    getAllAreasMock,
    getPublicAreaBySlugMock,
    getPublicAreaCamerasMock,
    getBrandingSettingsMock,
} = vi.hoisted(() => ({
    getPublicLandingCameraListMock: vi.fn(),
    getAllAreasMock: vi.fn(),
    getPublicAreaBySlugMock: vi.fn(),
    getPublicAreaCamerasMock: vi.fn(),
    getBrandingSettingsMock: vi.fn(),
}));

vi.mock('../services/cameraService.js', () => ({
    default: { getPublicLandingCameraList: getPublicLandingCameraListMock },
}));

vi.mock('../services/areaService.js', () => ({
    default: { getAllAreas: getAllAreasMock },
}));

vi.mock('../services/publicGrowthService.js', () => ({
    getPublicAreaBySlug: getPublicAreaBySlugMock,
    getPublicAreaCameras: getPublicAreaCamerasMock,
}));

vi.mock('../services/brandingService.js', () => ({
    default: { getBrandingSettings: getBrandingSettingsMock },
}));

const CAM = {
    id: 5,
    name: 'CCTV MUSHOLLA AT TIJAR 1',
    area_id: 2,
    area_name: 'DS DANDER',
    thumbnail_path: '/api/thumbnails/5.jpg',
    thumbnail_updated_at: '2026-09-26 10:00:00',
    external_snapshot_url: null,
    is_online: 1,
};

const AREA_CAM_THUMB = { id: 9, name: 'CCTV A', thumbnail_path: '/api/thumbnails/9.jpg', thumbnail_updated_at: 't9' };

async function buildApp() {
    const { default: publicGrowthRoutes } = await import('../routes/publicGrowthRoutes.js');
    const fastify = Fastify();
    await fastify.register(publicGrowthRoutes, { prefix: '/api/public' });
    return fastify;
}

describe('GET /api/public/og-meta', () => {
    beforeEach(() => {
        vi.resetModules();
        getPublicLandingCameraListMock.mockReset().mockReturnValue([CAM]);
        getAllAreasMock.mockReset().mockReturnValue({ areas: [] });
        getPublicAreaBySlugMock.mockReset();
        getPublicAreaCamerasMock.mockReset().mockReturnValue([AREA_CAM_THUMB]);
        getBrandingSettingsMock.mockReset().mockReturnValue({ company_name: 'RAF' });
    });

    it('emits camera-specific OG/Twitter tags for a ?camera= share URL', async () => {
        const fastify = await buildApp();
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/public/og-meta?path=/&camera=5-cctv-musholla-at-tijar-1',
            headers: { host: 'cctv.raf.my.id', 'x-forwarded-proto': 'https' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toMatch(/text\/html/);
        expect(response.body).toContain('og:title" content="CCTV MUSHOLLA AT TIJAR 1');
        expect(response.body).toContain('og:image" content="https://cctv.raf.my.id/api/thumbnails/5.jpg?v=');
        expect(response.body).toContain('og:url" content="https://cctv.raf.my.id/?camera=5-cctv-musholla-at-tijar-1"');
        expect(response.body).toContain('twitter:title');
        expect(response.body).toContain('twitter:image');
        await fastify.close();
    });

    it('prefers external_snapshot_url over the local thumbnail', async () => {
        getPublicLandingCameraListMock.mockReturnValue([
            { ...CAM, external_snapshot_url: 'https://snap.example/5.jpg' },
        ]);
        const fastify = await buildApp();
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/public/og-meta?path=/&camera=5-x',
            headers: { host: 'cctv.raf.my.id' },
        });

        expect(response.body).toContain('og:image" content="https://snap.example/5.jpg"');
        await fastify.close();
    });

    it('keeps the share canonical og:url for area-prefixed camera links', async () => {
        const fastify = await buildApp();
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/public/og-meta?path=/area/ds-dander&camera=5-cctv-musholla-at-tijar-1',
            headers: { host: 'cctv.raf.my.id' },
        });

        expect(response.body).toContain('og:url" content="https://cctv.raf.my.id/area/ds-dander?camera=5-cctv-musholla-at-tijar-1"');
        await fastify.close();
    });

    it('emits an empty fragment for a camera absent from the public list (private cameras never leak)', async () => {
        getPublicLandingCameraListMock.mockReturnValue([]); // camera 999 not public
        const fastify = await buildApp();
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/public/og-meta?path=/&camera=999-secret',
            headers: { host: 'cctv.raf.my.id' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('');
        await fastify.close();
    });

    it('emits an empty fragment when nothing matches', async () => {
        const fastify = await buildApp();
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/public/og-meta?path=/&camera=',
            headers: { host: 'cctv.raf.my.id' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('');
        await fastify.close();
    });

    it('emits area meta for /area/<slug> share links with the first thumbed camera as image', async () => {
        getPublicAreaBySlugMock.mockReturnValue({ id: 2, name: 'DS DANDER', slug: 'ds-dander', camera_count: 10 });
        const fastify = await buildApp();
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/public/og-meta?path=/area/ds-dander',
            headers: { host: 'cctv.raf.my.id' },
        });

        expect(response.body).toContain('og:title" content="CCTV DS DANDER');
        expect(response.body).toContain('og:image" content="https://cctv.raf.my.id/api/thumbnails/9.jpg?v=t9"');
        expect(response.body).toContain('og:url" content="https://cctv.raf.my.id/area/ds-dander"');
        expect(getPublicAreaCamerasMock).toHaveBeenCalledWith('ds-dander');
        await fastify.close();
    });

    it('escapes HTML-breaking characters in names', async () => {
        getPublicLandingCameraListMock.mockReturnValue([{ ...CAM, name: 'CCTV "A<B" & C>' }]);
        const fastify = await buildApp();
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/public/og-meta?path=/&camera=5-x',
            headers: { host: 'cctv.raf.my.id' },
        });

        expect(response.body).toContain('&quot;A&lt;B&quot; &amp; C&gt;');
        expect(response.body).not.toContain('"A<B"');
        await fastify.close();
    });

    it('degrades to an empty 200 fragment when the data source throws', async () => {
        getPublicLandingCameraListMock.mockImplementation(() => { throw new Error('db down'); });
        const fastify = await buildApp();
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/public/og-meta?path=/&camera=5-x',
            headers: { host: 'cctv.raf.my.id' },
        });

        // nginx renders whatever this returns INSIDE <head> — an error body would leak
        // into markup, so failures must answer empty, exactly like the lcp-card route.
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('');
        await fastify.close();
    });
});
