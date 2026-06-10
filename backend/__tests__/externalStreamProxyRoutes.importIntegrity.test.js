/*
Purpose: Source-level guards against the two regressions that took external_hls
         streams down in production (a2ba74e -> 7a01535):
           1. A fetch helper was called but not imported -> ReferenceError ->
              every proxyable external camera 502'd on the master playlist.
           2. The stale-while-revalidate master path (refreshMaster /
              lastGoodMaster) was defined but never wired into the handler, so
              the origin's intermittent 500s still reached the viewer.
Caller: Vitest backend stability suite.
Deps: Node fs/path/url, route source.
MainFuncs: import-vs-call-site integrity assertions + SWR wiring assertions.
SideEffects: Reads route source from disk.

Why source-level: consistent with externalStreamProxyRoutes.viewerSession.
stability.test.js — the repo deliberately avoids Fastify-in-process tests for
these handlers. The bug class here (an imported-name / call-site mismatch) is
fully deterministic from the source and is exactly what the unit tests missed,
because they exercised the pure helpers, never the route module's binding graph.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.join(dirname, '..', 'services', 'externalStreamProxyService.js'),
    'utf8',
);

// Extract the names imported from ./hlsProxyRoutes.js (the helper module).
function importedNamesFromHlsProxyRoutes(src) {
    const match = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/services\/hlsProxyService\.js'/);
    if (!match) return new Set();
    return new Set(
        match[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s.split(/\s+as\s+/)[0].trim()),
    );
}

describe('externalStreamProxyRoutes — import/call-site integrity', () => {
    const imported = importedNamesFromHlsProxyRoutes(source);

    // The fetch helpers the route can call. If any of these is invoked in the
    // handler but missing from the import block, Node throws ReferenceError at
    // request time (caught -> 502). This is the exact a2ba74e regression.
    const fetchHelpers = [
        'fetchTextUpstream',
        'fetchTextUpstreamWithRetry',
        'fetchBufferedBinaryUpstream',
    ];

    for (const helper of fetchHelpers) {
        it(`does not call ${helper}() unless it is imported`, () => {
            const isCalled = new RegExp(`\\b${helper}\\s*\\(`).test(source);
            if (isCalled) {
                expect(imported.has(helper)).toBe(true);
            }
        });
    }

    it('imports every hlsProxyRoutes helper it references by name', () => {
        // Generic guard: any identifier used from the helper module must be
        // imported. Catches the next "removed the import, kept the call" slip.
        const referenced = [
            'fetchTextUpstreamWithRetry',
            'fetchBufferedBinaryUpstream',
            'isExternalProxyTargetAllowed',
            'isExternalProxyUrlCompatible',
            'createHlsHttpClient',
            'safeAbort',
            'createHlsRouteState',
        ];
        for (const name of referenced) {
            const isCalledOrUsed = new RegExp(`\\b${name}\\b`).test(
                // strip the import line itself before checking usage
                source.replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/services\/hlsProxyService\.js'/, ''),
            );
            if (isCalledOrUsed) {
                expect(imported.has(name)).toBe(true);
            }
        }
    });

    it('does not import fetchTextUpstream when it makes no call to it (no dead import)', () => {
        const callsPlain = /\bfetchTextUpstream\s*\(/.test(source);
        if (!callsPlain) {
            expect(imported.has('fetchTextUpstream')).toBe(false);
        }
    });
});

describe('externalStreamProxyRoutes — master stale-while-revalidate wiring', () => {
    it('defines the refreshMaster + lastGoodMaster store', () => {
        expect(source).toContain('async function refreshMaster(camera)');
        expect(source).toContain('lastGoodMaster');
    });

    it('actually CALLS refreshMaster from the master handler (not just defines it)', () => {
        // The a2ba74e half-landing defined refreshMaster but the handler never
        // called it, so the origin's 500s still reached the viewer.
        expect(source).toContain('refreshMaster(camera)');
    });

    it('serves a stale master in the background-revalidate window', () => {
        expect(source).toContain('STALE-REVALIDATE');
        expect(source).toContain('MASTER_STALE_MS');
        expect(source).toContain('MASTER_FRESH_MS');
    });

    it('routes the master fetch through the retrying helper, not a single-shot fetch', () => {
        // refreshMaster is the only place the master is fetched; it must use
        // the retry wrapper so a single origin 5xx blip is absorbed.
        const blockStart = source.indexOf('async function refreshMaster(camera)');
        const blockEnd = source.indexOf('masterRefreshInflight.set(camera.id, promise)', blockStart);
        const block = source.slice(blockStart, blockEnd);
        expect(block).toContain('fetchTextUpstreamWithRetry');
    });
});

describe('externalStreamProxyRoutes — in-flight fetch de-duplication', () => {
    // Without de-dup, N concurrent viewers of the same freshly-rotated segment
    // each fire their own upstream fetch (N origin hits + N RAM buffers) — a
    // thundering herd that peaks exactly when a camera is popular. The segment
    // and child-playlist handlers must route through the deduping helpers.

    it('defines deduping helpers backed by in-flight maps', () => {
        expect(source).toContain('function fetchSegmentDeduped(');
        expect(source).toContain('function fetchChildPlaylistDeduped(');
        expect(source).toContain('segmentFetchInflight');
        expect(source).toContain('childFetchInflight');
    });

    it('the segment handler fetches via fetchSegmentDeduped (not a raw buffered fetch)', () => {
        // Find the binary-segment branch (after the isPlaylistTarget block) and
        // assert it goes through the deduper.
        const segKeyIdx = source.indexOf('buildSegmentCacheKey(camera.id, targetUrl, cacheKeyStripParams)');
        expect(segKeyIdx).toBeGreaterThan(-1);
        const block = source.slice(segKeyIdx);
        expect(block).toContain('fetchSegmentDeduped(camera, targetUrl, targetPath, cacheKey)');
    });

    it('the child-playlist handler fetches via fetchChildPlaylistDeduped', () => {
        expect(source).toContain('fetchChildPlaylistDeduped(camera, targetUrl, playlistCacheKey)');
    });

    it('clears the in-flight maps on plugin close (no leak across restarts)', () => {
        expect(source).toContain('segmentFetchInflight.clear()');
        expect(source).toContain('childFetchInflight.clear()');
    });

    it('deletes the in-flight entry when each fetch settles', () => {
        // finally() must remove the key so a failed fetch does not wedge all
        // future callers onto a rejected promise.
        expect(source).toContain('childFetchInflight.delete(playlistCacheKey)');
        expect(source).toContain('segmentFetchInflight.delete(cacheKey)');
    });
});
