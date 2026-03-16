import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import configRoutes from '../routes/configRoutes.js';

describe('configRoutes', () => {
    it('serves public runtime config for same-origin frontend bootstrapping', async () => {
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
        });
        expect(response.json().portPublic).toBeTruthy();

        await fastify.close();
    });

    it('serves the dynamic PWA manifest from branding settings', async () => {
        const fastify = Fastify();
        fastify.decorate('db', {
            prepare() {
                return {
                    all() {
                        return [
                            { key: 'company_name', value: 'RAF NET CCTV' },
                            { key: 'meta_title', value: 'Monitor CCTV' },
                            { key: 'meta_description', value: 'Pantau CCTV publik' },
                        ];
                    },
                };
            },
        });

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
});
