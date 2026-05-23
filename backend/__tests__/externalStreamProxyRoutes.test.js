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
