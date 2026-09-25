import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
}));

describe('configRoutes', () => {
    beforeEach(() => {
        vi.resetModules();
        queryMock.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('serves public runtime config for same-origin frontend bootstrapping', async () => {
        const { default: configRoutes } = await import('../routes/configRoutes.js');
        const fastify = Fastify();
        await fastify.register(configRoutes);

        const response = await fastify.inject({
            method: 'GET',
            url: '/api/config/public',
            headers: {
                'x-forwarded-proto': 'http',
                host: '172.17.11.12:800',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            apiUrl: '/api',
            protocol: 'http',
            wsProtocol: 'ws',
            appVersion: '1.0.0',
            buildId: 'unknown',
        });
        expect(response.json().portPublic).toBeTruthy();

        await fastify.close();
    });

    it('serves the dynamic PWA manifest from branding settings', async () => {
        // Table-aware: branding lives in `branding_settings`, NOT `settings`. Returning rows only for
        // the correct table means a manifest that queried `settings` (the old bug) would get [] and
        // fall back to the generic default — so this assertion actually guards the table name.
        queryMock.mockImplementation((sql) => {
            if (typeof sql === 'string' && sql.includes('branding_settings')) {
                return [
                    { key: 'company_name', value: 'RAF NET CCTV' },
                    { key: 'meta_title', value: 'Monitor CCTV' },
                    { key: 'meta_description', value: 'Pantau CCTV publik' },
                ];
            }
            return [];
        });

        const { default: configRoutes } = await import('../routes/configRoutes.js');
        const fastify = Fastify();
        await fastify.register(configRoutes);

        const response = await fastify.inject({
            method: 'GET',
            url: '/api/config/manifest',
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('application/manifest+json');
        expect(response.json()).toMatchObject({
            name: 'Monitor CCTV',
            short_name: 'RAF NET CCTV',
            start_url: '/',
            display: 'standalone',
        });

        await fastify.close();
    });

    it('falls back to a valid default manifest when branding lookup fails', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        queryMock.mockImplementation(() => {
            throw new Error('db unavailable');
        });

        const { default: configRoutes } = await import('../routes/configRoutes.js');
        const fastify = Fastify();
        await fastify.register(configRoutes);

        const response = await fastify.inject({
            method: 'GET',
            url: '/api/config/manifest',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            name: 'CCTV System',
            short_name: 'CCTV',
            start_url: '/',
            display: 'standalone',
        });
        expect(warnSpy).toHaveBeenCalledWith(
            '[ConfigRoutes] Failed to load branding settings for manifest:',
            'db unavailable'
        );

        await fastify.close();
    });

    it('serves /sitemap.xml with static public pages plus public area slugs', async () => {
        queryMock.mockImplementation((sql) => {
            if (typeof sql === 'string' && sql.includes('FROM areas')) {
                return [{ slug: 'gresik' }, { slug: 'malang' }];
            }
            return [];
        });

        const { default: configRoutes } = await import('../routes/configRoutes.js');
        const fastify = Fastify();
        await fastify.register(configRoutes);

        const response = await fastify.inject({
            method: 'GET',
            url: '/sitemap.xml',
            headers: { host: 'cctv.raf.my.id', 'x-forwarded-proto': 'https' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('application/xml');
        expect(response.body).toContain('<loc>https://cctv.raf.my.id/</loc>');
        expect(response.body).toContain('<loc>https://cctv.raf.my.id/area/gresik</loc>');
        expect(response.body).toContain('<loc>https://cctv.raf.my.id/area/malang</loc>');

        await fastify.close();
    });

    it('sitemap query only includes areas that carry publicly visible cameras', async () => {
        queryMock.mockImplementation(() => []);
        const { buildSitemapXml } = await import('../services/appConfigService.js');
        buildSitemapXml({ protocol: 'https', hostname: 'cctv.raf.my.id' });

        // The EXISTS filter must inline the shared public-visibility rule — an area whose
        // only cameras are owner_private must never leak a sitemap entry.
        const sql = queryMock.mock.calls.map(([arg]) => arg).find(
            (arg) => typeof arg === 'string' && arg.includes('FROM areas')
        );
        expect(sql).toBeTruthy();
        expect(sql).toContain("camera_class = 'community'");
        expect(sql).toContain("billing_status = 'active'");
        expect(sql).toContain('is_public = 1');
    });
});
