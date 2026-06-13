// @vitest-environment jsdom

/*
 * Purpose: Lock the apiClient request interceptor resolving the base URL per request from the live
 *          getApiUrl(), so it stays correct when the runtime config loads after bootstrap.
 * Caller: Frontend Vitest suite.
 * Deps: Vitest with config.js mocked; the real apiClient module + axios.
 * MainFuncs: apiClient dynamic base URL test.
 * SideEffects: None (only invokes the registered request interceptor directly).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const apiUrlRef = { current: 'https://first.example' };

vi.mock('../config/config.js', () => ({
    getApiUrl: () => apiUrlRef.current,
    getApiKey: () => '',
}));

async function runRequestInterceptors(apiClient, requestConfig) {
    let result = requestConfig;
    for (const handler of apiClient.interceptors.request.handlers) {
        if (handler && typeof handler.fulfilled === 'function') {
            result = await handler.fulfilled(result);
        }
    }
    return result;
}

describe('apiClient base URL resolution', () => {
    beforeEach(() => {
        vi.resetModules();
        apiUrlRef.current = 'https://first.example';
    });

    it('resolves baseURL per request from the live getApiUrl() (config can load after import)', async () => {
        const { default: apiClient } = await import('./apiClient.js');

        const first = await runRequestInterceptors(apiClient, { method: 'get', headers: {} });
        expect(first.baseURL).toBe('https://first.example');

        // Simulate runtime config resolving to a different URL after the client was created.
        apiUrlRef.current = 'https://second.example';
        const second = await runRequestInterceptors(apiClient, { method: 'get', headers: {} });
        expect(second.baseURL).toBe('https://second.example');
    });
});
