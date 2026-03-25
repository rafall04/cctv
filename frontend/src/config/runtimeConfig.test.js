import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiUrl, getRuntimeConfig, loadRuntimeConfig, normalizeApiBaseUrl, resetConfig } from './runtimeConfig';

describe('runtimeConfig', () => {
    beforeEach(() => {
        resetConfig();
        vi.restoreAllMocks();
    });

    it('normalizes /api runtime values to an empty backend origin base', () => {
        expect(normalizeApiBaseUrl('/api')).toBe('');
        expect(normalizeApiBaseUrl('')).toBe('');
        expect(normalizeApiBaseUrl('https://api.example.com')).toBe('https://api.example.com');
    });

    it('loads backend runtime config before consumers read the api base', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                apiUrl: '/api',
                frontendDomain: 'example.test',
                serverIp: '',
                portPublic: '80',
                protocol: 'http',
                wsProtocol: 'ws',
                appVersion: '1.0.0',
                buildId: 'build-123',
            }),
        }));

        await loadRuntimeConfig();

        expect(getApiUrl()).toBe('');
        expect(getRuntimeConfig()).toMatchObject({
            appVersion: '1.0.0',
            buildId: 'build-123',
        });
    });
});
