// @vitest-environment jsdom

/*
 * Purpose: Lock (a) the apiClient request interceptor resolving the base URL per request from the
 *          live getApiUrl(), and (b) the transport-level retry that rides out a Cloudflare tunnel
 *          re-dial — including its refusal to replay non-idempotent requests.
 * Caller: Frontend Vitest suite.
 * Deps: Vitest with config.js mocked; the real apiClient module + axios.
 * MainFuncs: apiClient dynamic base URL test.
 * SideEffects: None (only invokes the registered request interceptor directly).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

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


describe('network-error retry (tunnel re-dial)', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
    });

    /*
     * Hand the timers back. Fake timers are installed process-wide, so without this every test
     * that runs after this file in the same process — anything using waitFor/findBy, which drive
     * themselves off timers — waits forever and dies on the suite timeout. It stayed hidden only
     * because the default runner gives each file its own worker; it surfaces the moment files
     * share a process.
     */
    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Mock at the ADAPTER layer, not on apiClient.request: calling the instance as a function
     * (apiClient(config)) bypasses a spy on .request entirely, which silently let a real request
     * escape and hang the first version of this test.
     */
    async function load(adapterImpl) {
        const { default: apiClient } = await import('./apiClient.js');
        const adapter = vi.fn(adapterImpl);
        apiClient.defaults.adapter = adapter;
        return { apiClient, adapter };
    }

    async function drive(apiClient, error) {
        let out;
        for (const handler of apiClient.interceptors.response.handlers) {
            if (handler && typeof handler.rejected === 'function') {
                out = handler.rejected(error);
                break;
            }
        }
        const settled = out.then((v) => ({ ok: v }), (e) => ({ err: e }));
        await vi.advanceTimersByTimeAsync(400);
        await vi.advanceTimersByTimeAsync(1200);
        return settled;
    }

    it('replays a failed GET instead of surfacing "unable to connect"', async () => {
        const { apiClient, adapter } = await load(async (config) => ({
            data: { success: true }, status: 200, statusText: 'OK', headers: {}, config,
        }));
        const config = { method: 'get', url: '/api/cameras/active', headers: {} };

        const { ok, err } = await drive(apiClient, networkError(config));

        expect(err).toBeUndefined();
        expect(ok.data.success).toBe(true);
        expect(adapter).toHaveBeenCalledTimes(1);
        expect(config._networkRetry).toBe(1);
    });

    it('never replays a POST — it may already have reached the server', async () => {
        const { apiClient, adapter } = await load(async () => ({ data: {}, status: 200, headers: {} }));

        const { err } = await drive(apiClient, networkError({ method: 'post', url: '/api/x', headers: {} }));

        expect(err).toMatchObject({ code: 'ERR_NETWORK' });
        expect(adapter).not.toHaveBeenCalled();
    });

    it.each(['put', 'patch', 'delete'])('never replays %s either', async (method) => {
        const { apiClient, adapter } = await load(async () => ({ data: {}, status: 200, headers: {} }));

        const { err } = await drive(apiClient, networkError({ method, url: '/api/x', headers: {} }));

        expect(err).toMatchObject({ code: 'ERR_NETWORK' });
        expect(adapter).not.toHaveBeenCalled();
    });

    it('terminates when the network stays down — no infinite replay loop', async () => {
        // The retry counter lives on the request config, which axios re-merges on every call.
        // If that flag were dropped, a permanently broken tunnel would loop forever.
        const { apiClient, adapter } = await load(() => Promise.reject(networkError(undefined)));
        const config = { method: 'get', url: '/api/cameras/active', headers: {} };

        let outcome;
        for (const handler of apiClient.interceptors.response.handlers) {
            if (handler && typeof handler.rejected === 'function') {
                outcome = handler.rejected(networkError(config)).then((v) => ({ ok: v }), (e) => ({ err: e }));
                break;
            }
        }
        for (let i = 0; i < 12; i += 1) {
            await vi.advanceTimersByTimeAsync(1500);
        }

        expect((await outcome).err).toBeTruthy();
        expect(adapter.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('gives up after a bounded number of attempts rather than looping forever', async () => {
        const { apiClient, adapter } = await load(async () => ({ data: {}, status: 200, headers: {} }));
        const config = { method: 'get', url: '/api/cameras/active', headers: {}, _networkRetry: 2 };

        const { err } = await drive(apiClient, networkError(config));

        expect(err).toMatchObject({ code: 'ERR_NETWORK' });
        expect(adapter).not.toHaveBeenCalled();
    });
});

function networkError(config) {
    const err = new Error('Network Error');
    err.code = 'ERR_NETWORK';
    err.config = config;
    err.request = {};
    return err;
}
