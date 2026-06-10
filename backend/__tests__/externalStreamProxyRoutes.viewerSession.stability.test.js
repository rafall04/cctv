/*
Purpose: Source-level guards that the opaque + legacy HLS proxy routes track viewer sessions for external_hls cameras.
Caller: Vitest backend stability suite.
Deps: Node fs/path/url, route source files.
MainFuncs: stability assertions over proxy route source.
SideEffects: Reads route source from disk.

Why source-level: spinning up Fastify-in-process to integration-test
session bookkeeping is heavy and brittle; the bug we're guarding
against (regression where the proxy stops calling getOrCreateSession
/ recordSegmentAccess for external_hls and view counters silently
stop incrementing) is deterministic at the source level. If either
identifier disappears from the route handler the test fails.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const opaqueSource = fs.readFileSync(
    path.join(dirname, '..', 'services', 'externalStreamProxyService.js'),
    'utf8',
);
// handleExternalStreamProxy (the legacy /hls/proxy handler) now lives in the service module.
const legacySource = fs.readFileSync(
    path.join(dirname, '..', 'services', 'hlsProxyService.js'),
    'utf8',
);

describe('externalStreamProxyRoutes — viewer session tracking', () => {
    it('imports createHlsRouteState so it can share the same HlsSessionStore semantics as /hls/*', () => {
        expect(opaqueSource).toContain('createHlsRouteState');
    });

    it('starts the route state when it owns one so the periodic cleanup interval runs', () => {
        // Without start(), expired in-memory session entries never flush
        // and the corresponding DB sessions stay "active" forever — the
        // lifetime view counter (recordCompletedLiveView) only fires on
        // endSession, which only fires when the entry expires.
        expect(opaqueSource).toContain('routeState.start()');
    });

    it('tracks a viewer session on every master playlist fetch', () => {
        // The master playlist endpoint is the per-camera entry point;
        // it is hit every ~3s by HLS.js's playlist refresh loop, so
        // it doubles as the session heartbeat.
        expect(opaqueSource).toContain("trackViewerHeartbeat(request, camera.id, 'playlist')");
    });

    it('distinguishes child-playlist heartbeats from binary-segment heartbeats', () => {
        // Child playlists also need `playlist` heartbeats (they're hit
        // on the same cadence as the master); binary segments only need
        // `segment` heartbeats (no new session rows).
        expect(opaqueSource).toContain("isPlaylistTarget ? 'playlist' : 'segment'");
    });

    it('routes the playlist heartbeat through getOrCreateSession, not a raw startSession', () => {
        // getOrCreateSession dedupes by (identity, cameraId) so a 3-
        // second HLS playlist refresh loop does NOT create N session
        // rows per minute. Direct calls to viewerSessionService.start
        // here would re-introduce the duplicate-session bug.
        expect(opaqueSource).toContain('routeState.getOrCreateSession');
    });

    it('drains pending session closes on plugin shutdown when it owns the state', () => {
        // Graceful restart: any sessions still in the dedupe map need
        // to flush to DB so their final recordCompletedLiveView fires
        // and the lifetime counter doesn't lose a count.
        expect(opaqueSource).toContain('routeState.stop()');
    });
});

describe('hlsProxyRoutes /hls/proxy?url=... — viewer session tracking', () => {
    it('heartbeats a session on each external playlist proxy request', () => {
        // Pre-fix, handleExternalStreamProxy only recorded a
        // camera-health signal. The viewer session was never created,
        // so the view counter stayed at zero for any external_hls
        // camera that fell back to the legacy /hls/proxy path.
        expect(legacySource).toContain('state.getOrCreateSession(identity, externalCameraConfig.cameraId, request)');
    });

    it('heartbeats a session on each external segment proxy request', () => {
        expect(legacySource).toContain('state.recordSegmentAccess(identity, externalCameraConfig.cameraId)');
    });

    it('reuses the SAME state object that already powers the internal /hls/* route — no parallel session store', () => {
        // Both calls live inside handleExternalStreamProxy, which
        // receives `state` from the same createHlsRouteState() that
        // /hls/* uses. Sharing the store keeps live-viewer dedupe
        // accurate across the rare camera that flips between proxy
        // and direct-stream within the same session.
        const blockStart = legacySource.indexOf('async function handleExternalStreamProxy');
        const block = legacySource.slice(blockStart); // handler is the last function in the service module
        expect(block).toContain('state.getOrCreateSession');
        expect(block).toContain('state.recordSegmentAccess');
    });

    it('swallows session bookkeeping errors so the actual stream is never blocked', () => {
        // Belt-and-braces: if viewer-session DB write fails, the
        // upstream proxy must still serve the playlist / segment.
        const blockStart = legacySource.indexOf('async function handleExternalStreamProxy');
        const block = legacySource.slice(blockStart); // handler is the last function in the service module
        expect(block).toContain('External viewer session error');
    });
});
