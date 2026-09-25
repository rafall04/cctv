/*
Purpose: Verify provider-specific proxy glue — Malang Referer/Cookie injection, session minting + 403 re-mint retry, and the Gresik on-demand start URL.
Caller: Vitest backend suite.
Deps: vitest; node:https mocked (session minting), no real network.
MainFuncs: tests for buildExternalStartUrl, attachProviderInterceptors, resetExternalProviderForTests.
SideEffects: None.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { httpsRequestMock } = vi.hoisted(() => ({ httpsRequestMock: vi.fn() }));

vi.mock('node:https', async (importOriginal) => ({
    ...(await importOriginal()),
    default: {
        ...(await importOriginal()).default,
        request: httpsRequestMock,
    },
}));

import {
    buildExternalStartUrl,
    attachProviderInterceptors,
    buildProviderRequestHeaders,
    providerSupportsSession,
    resetExternalProviderForTests,
} from '../services/externalProviderSupport.js';

const MALANG_M3U8 = 'https://cctv.malangkota.go.id/cctv-stream/streams/abc123.m3u8';
const MALANG_SEG = 'https://cctv.malangkota.go.id/cctv-stream/streams/abc123_0p001.ts';

function stubMint(cookies = ['NANCY_TOKEN_Q=qa; Path=/', 'NANCY_TOKEN_W=wb; Path=/']) {
    httpsRequestMock.mockImplementation((url, opts, cb) => {
        const res = {
            headers: { 'set-cookie': cookies },
            resume() {},
        };
        queueMicrotask(() => cb(res));
        return {
            on() {},
            end() {},
            destroy() {},
        };
    });
}

function makeAxiosStub() {
    // Minimal axios-shaped double: runs request interceptors, "hits the
    // network" via a queued response list, then response interceptors —
    // mirroring axios's fulfilled-response path (validateStatus:()=>true
    // means 403 arrives as a resolved response).
    const stub = {
        interceptors: {
            request: { handlers: [], use(fn) { this.handlers.push(fn); } },
            response: { handlers: [], use(ok, err) { this.handlers.push({ ok, err }); } },
        },
        responses: [],
        async request(cfg) {
            for (const fn of stub.interceptors.request.handlers) cfg = await fn(cfg);
            let res = stub.responses.shift() || { status: 200, data: '' };
            res = { ...res, config: cfg };
            for (const h of stub.interceptors.response.handlers) res = await h.ok(res);
            return res;
        },
        get(url) { return stub.request({ url, method: 'get' }); },
    };
    return stub;
}

beforeEach(() => {
    resetExternalProviderForTests();
    httpsRequestMock.mockReset();
});

describe('buildExternalStartUrl', () => {
    it('emits the provider start endpoint for gresikkab profiles', () => {
        expect(buildExternalStartUrl({ source_profile: 'gresikkab:584' }))
            .toBe('https://cctvkanjeng.gresikkab.go.id/api/v1/public/cctv/584/start');
        expect(buildExternalStartUrl({ source_profile: 'gresikkab:de05c73a-459e-4e56-9bdf-f1d3245a5d56' }))
            .toBe('https://cctvkanjeng.gresikkab.go.id/api/v1/public/cctv/de05c73a-459e-4e56-9bdf-f1d3245a5d56/start');
    });

    it('returns null when there is no provider id to start', () => {
        expect(buildExternalStartUrl({ source_profile: null })).toBeNull();
        expect(buildExternalStartUrl({})).toBeNull();
        expect(buildExternalStartUrl({ source_profile: 'gresikkab' })).toBeNull();
        expect(buildExternalStartUrl({ source_profile: 'malangkota:12' })).toBeNull();
        // refuse path-injection through the stored id
        expect(buildExternalStartUrl({ source_profile: 'gresikkab:../admin' })).toBeNull();
        expect(buildExternalStartUrl({ source_profile: 'gresikkab:1?x=2' })).toBeNull();
    });
});

describe('attachProviderInterceptors — malangkota session', () => {
    beforeEach(() => stubMint());

    it('injects Referer + freshly-minted Cookie on playlist and segment requests', async () => {
        const http = makeAxiosStub();
        attachProviderInterceptors(http);
        http.responses.push({ status: 200, data: '#EXTM3U' }, { status: 200, data: 'ts' });
        const res = await http.get(MALANG_M3U8);
        await http.request({ url: MALANG_SEG, method: 'get', responseType: 'arraybuffer' });
        expect(res.status).toBe(200);
        // session minted once via the provider page, then cached for the segment
        expect(httpsRequestMock).toHaveBeenCalledTimes(1);
        expect(httpsRequestMock.mock.calls[0][0]).toBe('https://cctv.malangkota.go.id/sebaran-cctv');
        // provider's broken cert chain requires the insecure mint
        expect(httpsRequestMock.mock.calls[0][1].rejectUnauthorized).toBe(false);
        const sent = res.config.headers;
        expect(sent.Referer).toBe('https://cctv.malangkota.go.id/');
        expect(sent.Cookie).toContain('NANCY_TOKEN_Q=qa');
        expect(sent.Cookie).toContain('NANCY_TOKEN_W=wb');
    });

    it('re-mints once on a 403 and retries the same request', async () => {
        const http = makeAxiosStub();
        attachProviderInterceptors(http);
        http.responses.push({ status: 403, data: 'forbidden' }, { status: 200, data: '#EXTM3U' });
        const res = await http.get(MALANG_M3U8);
        expect(res.status).toBe(200);
        expect(httpsRequestMock).toHaveBeenCalledTimes(2); // initial mint + forced re-mint
    });

    it('passes a persistent 403 through instead of looping', async () => {
        const http = makeAxiosStub();
        attachProviderInterceptors(http);
        http.responses.push({ status: 403 }, { status: 403 });
        const res = await http.get(MALANG_M3U8);
        expect(res.status).toBe(403);
        expect(httpsRequestMock).toHaveBeenCalledTimes(2);
    });
});

describe('buildProviderRequestHeaders — non-axios consumers (ffmpeg thumbnails)', () => {
    beforeEach(() => stubMint());

    it('returns Referer + minted Cookie for a provider host', async () => {
        const headers = await buildProviderRequestHeaders(MALANG_M3U8);
        expect(headers.Referer).toBe('https://cctv.malangkota.go.id/');
        expect(headers.Cookie).toContain('NANCY_TOKEN_Q=qa');
        expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    });

    it('returns null for unregistered hosts without minting', async () => {
        expect(await buildProviderRequestHeaders('https://cctvkanjeng.gresikkab.go.id/hls/x/index.m3u8')).toBeNull();
        expect(httpsRequestMock).not.toHaveBeenCalled();
    });

    it('providerSupportsSession flags provider hosts synchronously', () => {
        expect(providerSupportsSession(MALANG_M3U8)).toBe(true);
        expect(providerSupportsSession('https://cctvjss.jogjakota.go.id/x.m3u8')).toBe(false);
        expect(providerSupportsSession('not a url')).toBe(false);
    });
});

describe('attachProviderInterceptors — passthrough + guards', () => {
    it('never mints sessions or adds headers for unregistered hosts', async () => {
        const http = makeAxiosStub();
        attachProviderInterceptors(http);
        http.responses.push({ status: 200 });
        const res = await http.get('https://cctvjss.jogjakota.go.id/atcs/x.stream/playlist.m3u8');
        expect(res.config.headers?.Cookie).toBeUndefined();
        expect(res.config.headers?.Referer).toBeUndefined();
        expect(httpsRequestMock).not.toHaveBeenCalled();
    });

    it('survives axios doubles that lack interceptors (injected test clients)', () => {
        expect(() => attachProviderInterceptors({})).not.toThrow();
        expect(() => attachProviderInterceptors(null)).not.toThrow();
    });
});
