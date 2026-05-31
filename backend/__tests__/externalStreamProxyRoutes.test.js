/*
Purpose: Verify the opaque /api/stream/:cameraId/external.* routes — playlist rewriting, segment validation, cache hits, refusal paths.
Caller: Vitest backend suite.
Deps: vitest, externalStreamProxyRoutes pure helpers.
MainFuncs: tests for buildOpaqueSegmentUrl, rewriteOpaquePlaylist, resolveSegmentTargetUrl.
SideEffects: None — these tests exercise the pure helpers; route handlers are integration-tested via the live server in dev.
*/

import { describe, expect, it } from 'vitest';
import {
    buildOpaqueSegmentUrl,
    rewriteOpaquePlaylist,
    resolveSegmentTargetUrl,
    buildSegmentCacheKey,
} from '../routes/externalStreamProxyRoutes.js';

describe('externalStreamProxyRoutes — buildOpaqueSegmentUrl', () => {
    const playlistUrl = 'https://cctv.example.gov.id/live/cam7/playlist.m3u8';

    it('produces an opaque path for a relative segment line', () => {
        expect(buildOpaqueSegmentUrl(7, 'chunk_001.ts', playlistUrl))
            .toBe('/api/stream/7/external-segment/chunk_001.ts');
    });

    it('produces an opaque path for an absolute URL on the same host', () => {
        expect(buildOpaqueSegmentUrl(7, 'https://cctv.example.gov.id/live/cam7/chunk_002.ts', playlistUrl))
            .toBe('/api/stream/7/external-segment/chunk_002.ts');
    });

    it('encodes path components safely (no raw slashes in the URI segment)', () => {
        // Sub-directory nested under playlist base.
        expect(buildOpaqueSegmentUrl(7, 'subdir/chunk_003.ts', playlistUrl))
            .toBe('/api/stream/7/external-segment/subdir%2Fchunk_003.ts');
    });

    it('falls back to last path component for a cross-host segment URL', () => {
        // Different host - we'll let the backend validator decide later;
        // the rewriter just needs to produce something parsable.
        expect(buildOpaqueSegmentUrl(7, 'https://cdn.othercdn.com/live/cam7/seg.ts', playlistUrl))
            .toBe('/api/stream/7/external-segment/seg.ts');
    });

    it('returns empty string for an unparseable line', () => {
        expect(buildOpaqueSegmentUrl(7, '', playlistUrl)).toBe('');
    });
});

describe('externalStreamProxyRoutes — rewriteOpaquePlaylist', () => {
    const playlistUrl = 'https://cctv.example.gov.id/live/cam7/playlist.m3u8';

    it('rewrites only segment lines, preserves directives and blank lines', () => {
        const input = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:6',
            '',
            '#EXTINF:6.0,',
            'chunk_001.ts',
            '#EXTINF:6.0,',
            'chunk_002.ts',
            '#EXT-X-ENDLIST',
        ].join('\n');

        const out = rewriteOpaquePlaylist(input, playlistUrl, 7);

        // Directives untouched.
        expect(out).toContain('#EXTM3U');
        expect(out).toContain('#EXTINF:6.0,');
        expect(out).toContain('#EXT-X-ENDLIST');

        // Segment lines replaced.
        expect(out).toContain('/api/stream/7/external-segment/chunk_001.ts');
        expect(out).toContain('/api/stream/7/external-segment/chunk_002.ts');

        // Original segment filenames must no longer appear as bare lines.
        const lines = out.split('\n');
        expect(lines).not.toContain('chunk_001.ts');
        expect(lines).not.toContain('chunk_002.ts');
    });

    it('handles an empty playlist text without throwing', () => {
        expect(rewriteOpaquePlaylist('', playlistUrl, 7)).toBe('');
        expect(rewriteOpaquePlaylist(null, playlistUrl, 7)).toBe('');
    });

    it('rewrites URI="..." inside #EXT-X-MAP so fMP4 init segments flow through the proxy', () => {
        // Real-world bug: gov upstream emits an ABSOLUTE URI for the
        // fMP4 init segment. Without rewriting, the player follows the
        // raw upstream URL → cross-origin fetch → CORS block → 5
        // retries → stream dies. The init URI MUST be opaque.
        const input = [
            '#EXTM3U',
            '#EXT-X-VERSION:7',
            '#EXT-X-TARGETDURATION:6',
            '#EXT-X-MAP:URI="https://cctv.example.gov.id/live/cam7/init.mp4"',
            '#EXTINF:6.0,',
            'chunk_001.m4s',
        ].join('\n');

        const out = rewriteOpaquePlaylist(input, playlistUrl, 7);

        expect(out).toContain('#EXT-X-MAP:URI="/api/stream/7/external-segment/init.mp4"');
        // Raw upstream URL must NOT survive the rewrite anywhere.
        expect(out).not.toContain('cctv.example.gov.id');
    });

    it('rewrites URI="..." inside #EXT-X-KEY so encryption keys flow through the proxy', () => {
        const input = [
            '#EXTM3U',
            '#EXT-X-KEY:METHOD=AES-128,URI="https://cctv.example.gov.id/live/cam7/key.bin",IV=0x0',
            '#EXTINF:6.0,',
            'chunk_001.ts',
        ].join('\n');

        const out = rewriteOpaquePlaylist(input, playlistUrl, 7);

        expect(out).toContain('URI="/api/stream/7/external-segment/key.bin"');
        // The METHOD and IV attributes are preserved.
        expect(out).toContain('METHOD=AES-128');
        expect(out).toContain('IV=0x0');
        expect(out).not.toContain('cctv.example.gov.id');
    });

    it('rewrites URI="..." inside #EXT-X-MEDIA alt rendition tags', () => {
        // Alt audio / subtitle renditions reference child playlists
        // by URI in the tag attribute. Same leak class as #EXT-X-MAP.
        const input = [
            '#EXTM3U',
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",URI="audio_only.m3u8"',
            '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="subs/eng.vtt"',
            '#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio"',
            'video.m3u8',
        ].join('\n');

        const out = rewriteOpaquePlaylist(input, playlistUrl, 7);

        expect(out).toContain('URI="/api/stream/7/external-segment/audio_only.m3u8"');
        expect(out).toContain('URI="/api/stream/7/external-segment/subs%2Feng.vtt"');
        // Standalone segment line is rewritten the same way as before.
        expect(out).toContain('/api/stream/7/external-segment/video.m3u8');
    });

    it('preserves the query string (auth token) when rewriting tokenised segment URLs', () => {
        // Wowza / signed-CDN upstreams attach `?wmsAuthSign=...` or
        // similar auth tokens to every segment URL. Without preserving
        // the query, the backend's segment fetch is rejected with
        // 401/403 and the stream stalls.
        const input = [
            '#EXTM3U',
            '#EXTINF:6.0,',
            'chunk_001.ts?wmsAuthSign=server%3Dabc%26token%3Dxyz',
        ].join('\n');

        const out = rewriteOpaquePlaylist(input, playlistUrl, 7);
        const opaqueLine = out
            .split('\n')
            .find((line) => line.startsWith('/api/stream/7/external-segment/'));

        expect(opaqueLine).toBeTruthy();
        // The query string survives the rewrite (URL-encoded) — once
        // the backend decodes the filename it can re-attach it to the
        // upstream URL.
        const decoded = decodeURIComponent(opaqueLine.split('/').pop());
        expect(decoded).toContain('chunk_001.ts');
        expect(decoded).toContain('wmsAuthSign');
        expect(decoded).toContain('token');
    });
});

describe('externalStreamProxyRoutes — resolveSegmentTargetUrl', () => {
    const camera = {
        id: 7,
        external_hls_url: 'https://cctv.example.gov.id/live/cam7/playlist.m3u8',
    };
    const allowOptions = { allowPrivateHosts: false, allowedHosts: [] };

    it('reconstructs the full upstream URL from a valid segment filename', () => {
        expect(resolveSegmentTargetUrl(camera, 'chunk_001.ts', allowOptions))
            .toBe('https://cctv.example.gov.id/live/cam7/chunk_001.ts');
    });

    it('accepts URL-encoded slashes for nested paths', () => {
        expect(resolveSegmentTargetUrl(camera, encodeURIComponent('subdir/chunk_001.ts'), allowOptions))
            .toBe('https://cctv.example.gov.id/live/cam7/subdir/chunk_001.ts');
    });

    it('rejects a filename outside the whitelist extension set', () => {
        expect(resolveSegmentTargetUrl(camera, 'chunk_001.txt', allowOptions)).toBeNull();
        expect(resolveSegmentTargetUrl(camera, 'index.html', allowOptions)).toBeNull();
    });

    it('accepts .m3u8 filenames so master-playlist child references flow through', () => {
        // Regression — a master playlist's entries are themselves child
        // playlists, e.g. `05dfbeca-..._output_0.m3u8`. The rewriter sends
        // those through the same /external-segment endpoint. Previously
        // the regex only accepted .ts/.m4s/.mp4 and returned 400 here.
        const result = resolveSegmentTargetUrl(
            camera,
            '05dfbeca-138c-4e12-a89a-c7b4f08375e7_output_0.m3u8',
            allowOptions,
        );
        expect(result).toBe(
            'https://cctv.example.gov.id/live/cam7/05dfbeca-138c-4e12-a89a-c7b4f08375e7_output_0.m3u8',
        );
    });

    it('rejects path traversal attempts', () => {
        expect(resolveSegmentTargetUrl(camera, '../../etc/passwd.ts', allowOptions)).toBeNull();
        expect(resolveSegmentTargetUrl(camera, encodeURIComponent('../escape.ts'), allowOptions)).toBeNull();
    });

    it('rejects absolute paths', () => {
        // %2F-encoded leading slash is decoded then refused.
        expect(resolveSegmentTargetUrl(camera, '%2Fetc%2Fpasswd.ts', allowOptions)).toBeNull();
    });

    it('rejects bad URI encoding without throwing', () => {
        expect(resolveSegmentTargetUrl(camera, '%E0%A4%A', allowOptions)).toBeNull();
    });

    it('returns null for cameras without an external_hls_url', () => {
        expect(resolveSegmentTargetUrl({ id: 9, external_hls_url: null }, 'chunk_001.ts', allowOptions)).toBeNull();
    });

    it('returns null when the resulting URL would target a different host', () => {
        // Synthetic case: a filename containing a fully qualified URL is
        // not legal under the regex (no `://` allowed by the pattern),
        // so this should be refused outright.
        expect(resolveSegmentTargetUrl(camera, 'https%3A%2F%2Fevil.com%2Fseg.ts', allowOptions)).toBeNull();
    });

    it('preserves the query string when reconstructing a tokenised segment URL', () => {
        // The full opaque filename includes URL-encoded query string.
        // After decoding we expect the upstream URL to keep its auth
        // token verbatim — Wowza wmsAuthSign and similar token schemes
        // refuse fetches that strip the signature.
        const opaqueFilename = encodeURIComponent('chunk_001.ts?wmsAuthSign=server%3Dabc&token=xyz');
        expect(resolveSegmentTargetUrl(camera, opaqueFilename, allowOptions))
            .toBe('https://cctv.example.gov.id/live/cam7/chunk_001.ts?wmsAuthSign=server%3Dabc&token=xyz');
    });

    it('accepts encryption-key (.key/.bin) and subtitle (.vtt) extensions for directive URI fetches', () => {
        // Without these extensions the rewriter's #EXT-X-KEY /
        // #EXT-X-MEDIA-rewrites would emit opaque URLs that the
        // segment handler then rejects with 400 — same class of bug
        // as the master/.m3u8 rejection that b271d1d fixed.
        expect(resolveSegmentTargetUrl(camera, 'key.bin', allowOptions))
            .toBe('https://cctv.example.gov.id/live/cam7/key.bin');
        expect(resolveSegmentTargetUrl(camera, 'enc.key', allowOptions))
            .toBe('https://cctv.example.gov.id/live/cam7/enc.key');
        expect(resolveSegmentTargetUrl(camera, encodeURIComponent('subs/eng.vtt'), allowOptions))
            .toBe('https://cctv.example.gov.id/live/cam7/subs/eng.vtt');
    });

    it('honors a global allowedHosts whitelist when configured', () => {
        const allowed = resolveSegmentTargetUrl(camera, 'chunk_001.ts', {
            allowPrivateHosts: false,
            allowedHosts: ['cctv.example.gov.id'],
        });
        expect(allowed).toBe('https://cctv.example.gov.id/live/cam7/chunk_001.ts');

        const denied = resolveSegmentTargetUrl(camera, 'chunk_001.ts', {
            allowPrivateHosts: false,
            allowedHosts: ['some-other-host.example'],
        });
        expect(denied).toBeNull();
    });
});

describe('externalStreamProxyRoutes — buildSegmentCacheKey', () => {
    // #1: token-rotating origins (e.g. Diskominfo Bojonegoro mints a fresh
    // `?session=` on every playlist poll and stamps it onto each segment URL)
    // used to fragment the segment cache 100% — the same immutable `_NNN.ts`
    // bytes got a different key every poll, so the in-memory cache AND the
    // Cloudflare edge missed every time and the VPS re-pulled the origin for
    // every viewer on every poll. The key now drops the per-viewer session
    // params; the token is still sent upstream (resolveSegmentTargetUrl keeps
    // it on the fetch URL).

    it('collapses a rotating session token so the same segment shares one cache key', () => {
        const a = buildSegmentCacheKey(7, 'https://h.gov.id/live/seg_334829.ts?session=AAA');
        const b = buildSegmentCacheKey(7, 'https://h.gov.id/live/seg_334829.ts?session=BBB');
        expect(a).toBe(b);
        // The token must not survive into the key.
        expect(a).not.toContain('AAA');
        expect(a).not.toContain('session=');
    });

    it('strips each of the default session-scope param names', () => {
        for (const param of ['session', 'sessionid', 'session_id', 'token']) {
            const a = buildSegmentCacheKey(7, `https://h/seg.ts?${param}=AAA`);
            const b = buildSegmentCacheKey(7, `https://h/seg.ts?${param}=BBB`);
            expect(a).toBe(b);
        }
    });

    it('keeps a distinct key for two different cameras sharing the same upstream URL', () => {
        const a = buildSegmentCacheKey(7, 'https://h/seg.ts?session=AAA');
        const b = buildSegmentCacheKey(8, 'https://h/seg.ts?session=AAA');
        expect(a).not.toBe(b);
    });

    it('does NOT collapse per-segment signed tokens (e.g. wmsAuthSign) — content identity must stay', () => {
        // Wowza / signed-CDN upstreams mint a DIFFERENT signature per segment,
        // so the signature is part of the resource identity and must remain in
        // the key. wmsAuthSign is intentionally absent from the default strip list.
        const a = buildSegmentCacheKey(7, 'https://h/seg.ts?wmsAuthSign=AAA');
        const b = buildSegmentCacheKey(7, 'https://h/seg.ts?wmsAuthSign=BBB');
        expect(a).not.toBe(b);
    });

    it('respects a custom strip list (e.g. an operator-tuned token param)', () => {
        const a = buildSegmentCacheKey(7, 'https://h/seg.ts?sig=AAA', ['sig']);
        const b = buildSegmentCacheKey(7, 'https://h/seg.ts?sig=BBB', ['sig']);
        expect(a).toBe(b);
    });

    it('round-trips a token-free URL unchanged (no surprise re-encoding)', () => {
        expect(buildSegmentCacheKey(7, 'https://h/live/seg_001.ts'))
            .toBe('7|seg|https://h/live/seg_001.ts');
    });

    it('preserves non-token query params while dropping the session token', () => {
        const key = buildSegmentCacheKey(7, 'https://h/seg.ts?session=AAA&q=720p');
        expect(key).toContain('q=720p');
        expect(key).not.toContain('session');
    });
});
