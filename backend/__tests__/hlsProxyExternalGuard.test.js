/**
 * Purpose: Pin the /hls/proxy anti-open-proxy / anti-SSRF guard — a request with no valid camera
 *          binding is refused unless the operator set an explicit allow-list. (Audit v1.2.0, S-03.)
 * Caller: Backend Vitest suite for services/hlsProxyService.js.
 * Deps: vitest; real handleExternalStreamProxy with a minimal fake state/request/reply.
 * MainFuncs: rejection of anonymous ?url= proxying.
 * SideEffects: None — no DB, no network (guard rejects before any upstream fetch).
 */
import { describe, expect, it } from 'vitest';
import { handleExternalStreamProxy } from '../services/hlsProxyService.js';

function fakeReply() {
    return {
        _code: 200,
        _body: undefined,
        headers: {},
        header(k, v) { this.headers[k.toLowerCase()] = v; return this; },
        code(c) { this._code = c; return this; },
        send(b) { this._body = b; return this; },
    };
}

const stateWith = (allowedHosts) => ({
    options: { externalProxyAllowedHosts: allowedHosts, externalProxyAllowPrivateHosts: false },
    // Present so a no-cameraId path never accidentally resolves a binding.
    getExternalCameraProxyConfig: () => null,
});

describe('/hls/proxy anti-open-proxy guard (S-03)', () => {
    it('refuses an anonymous ?url= to a public host when no allow-list is configured', async () => {
        const reply = fakeReply();
        await handleExternalStreamProxy(
            stateWith([]),
            { headers: {}, query: { url: 'https://evil.example.com/playlist.m3u8' } },
            reply,
        );
        expect(reply._code).toBe(400);
    });

    it('refuses even with no url parameter (unchanged)', async () => {
        const reply = fakeReply();
        await handleExternalStreamProxy(stateWith([]), { headers: {}, query: {} }, reply);
        expect(reply._code).toBe(400);
    });
});
