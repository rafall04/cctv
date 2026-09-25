/*
 * Purpose: Pin what GET /api/cameras/active is allowed to publish — internal health fields, and
 *          the origin URL of a stream the backend is supposed to be proxying.
 * Caller: Vitest backend test suite.
 * Deps: services/publicLandingProjection.js (pure function, no mocks needed).
 * MainFuncs: stripInternalLandingFields.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import {
    buildLcpCardFragment,
    CREDENTIALED_EXTERNAL_URL_FIELDS,
    pickFirstGridCamera,
    PROXIED_ORIGIN_URL_FIELDS,
    PUBLIC_LANDING_INTERNAL_FIELDS,
    PUBLIC_LANDING_SLIM_FIELDS,
    slimLandingCamera,
    stripInternalLandingFields,
    stripProxiedOriginUrls,
} from '../services/publicLandingProjection.js';
import { readFileSync } from 'fs';

const proxiedExternalCamera = () => ({
    id: 15,
    name: 'PEREMPATAN JEMBATAN SOSRODILOGO',
    stream_source: 'external',
    delivery_type: 'external_hls',
    external_use_proxy: 1,
    external_stream_url: 'https://origin.example.go.id/live/abc.m3u8',
    external_hls_url: 'https://origin.example.go.id/live/abc.m3u8',
    external_snapshot_url: 'https://origin.example.go.id/snap.jpg',
    external_embed_url: null,
    monitoring_state: 'passive',
    availability_state: 'online',
});

describe('stripInternalLandingFields', () => {
    it('removes every internal monitoring/health field', () => {
        const camera = { id: 1 };
        for (const field of PUBLIC_LANDING_INTERNAL_FIELDS) {
            camera[field] = 'internal';
        }

        const result = stripInternalLandingFields(camera);

        for (const field of PUBLIC_LANDING_INTERNAL_FIELDS) {
            expect(result, `${field} must not reach the public payload`).not.toHaveProperty(field);
        }
        expect(result.id).toBe(1);
    });

    /*
     * REGRESSION: `external_use_proxy = 1` means every viewer is supposed to reach the feed
     * through the backend /hls proxy — that is what enforces access control and hides our
     * traffic from the third party. Publishing the origin .m3u8 in the public payload handed
     * anyone who opened the endpoint a way straight past it.
     */
    it('hides the origin URLs of a proxied external HLS camera', () => {
        const result = stripInternalLandingFields(proxiedExternalCamera());

        for (const field of PROXIED_ORIGIN_URL_FIELDS) {
            expect(result, `${field} must not reach the public payload`).not.toHaveProperty(field);
        }
        // Identity and the fields the public card actually renders survive.
        expect(result.name).toBe('PEREMPATAN JEMBATAN SOSRODILOGO');
        expect(result.delivery_type).toBe('external_hls');
        expect(result.availability_state).toBe('online');
    });

    /*
     * REGRESSION on the fix itself: `external_snapshot_url` was briefly stripped alongside the
     * stream origins. It is a still image that never goes near the HLS proxy, and the public UI
     * prefers it OVER thumbnail_path (LandingCameraCard / LandingHeroSpotlight /
     * PlaybackCameraPicker all read `external_snapshot_url || thumbnail_path`, and LandingHero
     * hides the whole spotlight when neither exists). Removing it cost pictures and bought
     * nothing.
     */
    it('keeps external_snapshot_url — it is the preferred public thumbnail, not a stream origin', () => {
        const result = stripInternalLandingFields(proxiedExternalCamera());
        expect(result.external_snapshot_url).toBe('https://origin.example.go.id/snap.jpg');
    });

    it('accepts a boolean external_use_proxy as well as 1', () => {
        const result = stripInternalLandingFields({ ...proxiedExternalCamera(), external_use_proxy: true });
        expect(result).not.toHaveProperty('external_stream_url');
    });

    /*
     * The client genuinely needs the raw URL in these cases, so stripping it would break
     * playback rather than harden it.
     */
    it('keeps the URL when the proxy is off — the player streams direct', () => {
        const result = stripInternalLandingFields({ ...proxiedExternalCamera(), external_use_proxy: 0 });
        expect(result.external_stream_url).toBe('https://origin.example.go.id/live/abc.m3u8');
    });

    it('keeps the URL for delivery types the HLS proxy does not serve', () => {
        for (const delivery_type of ['external_embed', 'external_flv', 'external_mjpeg']) {
            const result = stripInternalLandingFields({ ...proxiedExternalCamera(), delivery_type });
            expect(result.external_stream_url, `${delivery_type} needs its own URL`).toBeTruthy();
        }
    });

    it('keeps the URL when delivery_type is unset, so type inference still works', () => {
        // getEffectiveDeliveryType() on the frontend falls back to inferring the type FROM
        // these URLs when delivery_type is missing; removing them would break that.
        const result = stripInternalLandingFields({ ...proxiedExternalCamera(), delivery_type: null });
        expect(result.external_stream_url).toBeTruthy();
    });

    it('leaves internal cameras untouched', () => {
        const result = stripInternalLandingFields({
            id: 2, stream_source: 'internal', delivery_type: 'internal_hls', external_use_proxy: 1,
        });
        expect(result.id).toBe(2);
    });

    it('passes through non-objects unchanged', () => {
        expect(stripInternalLandingFields(null)).toBeNull();
        expect(stripInternalLandingFields(undefined)).toBeUndefined();
    });
});

/*
 * The origin-URL rule has to hold on EVERY public endpoint, not just the landing list.
 * It was first fixed only in stripInternalLandingFields, while /api/public/discovery went on
 * publishing the same URLs — plus `stream_key` — from publicGrowthService. Closing one door
 * and leaving the next one open is not hardening, so both now share one helper and this
 * pins the second consumer against silently drifting back.
 */
describe('public growth payload (/api/public/*)', () => {
    const source = readFileSync(new URL('../services/publicGrowthService.js', import.meta.url), 'utf8');

    it('never selects or emits stream_key', () => {
        // stream_key is the MediaMTX path name cameraAccessService resolves access against.
        const code = source.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));
        expect(code.join('\n')).not.toMatch(/stream_key/);
    });

    it('routes its rows through the shared origin-URL strip', () => {
        expect(source).toContain('stripProxiedOriginUrls');
        // It must decide on the camera's real policy, not on an absent column.
        expect(source).toMatch(/COALESCE\(c\.external_use_proxy, 1\)/);
    });

    it('strips origin URLs from a proxied external row the way the landing list does', () => {
        const row = {
            id: 7,
            name: 'SIMPANG 4 TEUKU UMAR',
            stream_source: 'external',
            delivery_type: 'external_hls',
            external_use_proxy: 1,
            external_stream_url: 'https://origin.example.go.id/live/x.m3u8',
            external_hls_url: 'https://origin.example.go.id/live/x.m3u8',
        };

        const result = stripProxiedOriginUrls(row);

        expect(result).not.toHaveProperty('external_stream_url');
        expect(result).not.toHaveProperty('external_hls_url');
        expect(result.name).toBe('SIMPANG 4 TEUKU UMAR');
    });
});

/*
 * THEME C: an admin who pastes credentials into ANY external URL (https://user:pass@host/…) must not
 * leak them to anonymous clients. The proxy-strip above only nulls stream/hls WHEN proxied; embed and
 * snapshot are never nulled, and a non-proxied stream/hls ships raw — so the userinfo is stripped from
 * ALL of them, unconditionally, while the URL stays functional.
 */
describe('stripProxiedOriginUrls — credential stripping (THEME C)', () => {
    it('strips user:pass@ from embed & snapshot even on a NON-proxied camera (early-return path)', () => {
        const row = {
            id: 9,
            name: 'PASAR',
            stream_source: 'external',
            delivery_type: 'external_embed', // not external_hls → proxy-strip does NOT fire
            external_use_proxy: 0,
            external_embed_url: 'https://user:secret@embed.example/player?token=keep',
            external_snapshot_url: 'https://admin:pw@snap.example/still.jpg',
        };

        const result = stripProxiedOriginUrls(row);

        expect(result.external_embed_url).toBe('https://embed.example/player?token=keep'); // token kept
        expect(result.external_snapshot_url).toBe('https://snap.example/still.jpg');
        expect(result.name).toBe('PASAR');
    });

    it('strips user:pass@ from a NON-proxied stream/hls URL that still ships raw', () => {
        const row = {
            id: 10,
            stream_source: 'external',
            delivery_type: 'external_hls',
            external_use_proxy: 0, // not proxied → URL is emitted, so it must be credential-clean
            external_stream_url: 'https://u:p@origin.example/live.m3u8',
            external_hls_url: 'https://u:p@origin.example/live.m3u8',
        };

        const result = stripProxiedOriginUrls(row);

        expect(result.external_stream_url).toBe('https://origin.example/live.m3u8');
        expect(result.external_hls_url).toBe('https://origin.example/live.m3u8');
    });

    it('returns a credential-free row BYTE-IDENTICAL (same object reference, no needless copy)', () => {
        const row = {
            id: 11,
            stream_source: 'external',
            delivery_type: 'external_embed',
            external_use_proxy: 0,
            external_embed_url: 'https://embed.example/player',
            external_snapshot_url: 'https://snap.example/still.jpg',
        };
        expect(stripProxiedOriginUrls(row)).toBe(row); // no copy → nothing to strip
    });

    it('the four credentialed fields are exactly the external URL set', () => {
        expect(CREDENTIALED_EXTERNAL_URL_FIELDS).toEqual([
            'external_stream_url', 'external_hls_url', 'external_embed_url', 'external_snapshot_url',
        ]);
    });

    it('end-to-end via stripInternalLandingFields (surface /api/cameras/active) also strips creds', () => {
        const result = stripInternalLandingFields({
            id: 12, stream_source: 'external', delivery_type: 'external_embed', external_use_proxy: 0,
            external_snapshot_url: 'https://user:pass@snap.example/x.jpg',
        });
        expect(result.external_snapshot_url).toBe('https://snap.example/x.jpg');
    });
});

describe('slimLandingCamera (?summary=1)', () => {
    it('keeps only the fields public landing code reads', () => {
        const fat = {
            id: 7, name: 'CCTV A', location: 'Dander', area_id: 2, area_name: 'DS DANDER',
            is_tunnel: 0, latitude: -7.25, longitude: 111.83, status: 'active', enabled: 1,
            enable_recording: 1, camera_class: 'community', video_codec: 'h265',
            thumbnail_path: '/api/thumbnails/7.jpg', thumbnail_updated_at: '2026-09-25 12:00:00',
            external_snapshot_url: null, delivery_type: 'internal_hls', is_online: 1,
            availability_state: 'online', live_viewers: 3, total_views: 900, viewer_stats: { live_viewers: 3 },
            is_recording: 1, created_at: '2026-05-04 08:00:00',
            // Everything below must NOT survive the slim projection:
            description: 'internal notes', group_name: null, stream_source: 'internal',
            external_hls_url: 'https://origin.example/x.m3u8',
            external_stream_url: 'https://origin.example/x.m3u8',
            external_embed_url: null, external_origin_mode: 'direct', external_tls_mode: 'strict',
            external_use_proxy: 1, availability_reason: 'x', availability_confidence: 'high',
        };

        const slim = slimLandingCamera(fat);
        const slimKeys = Object.keys(slim).sort();
        expect(slimKeys).toEqual([...PUBLIC_LANDING_SLIM_FIELDS].sort());
        expect(slim.id).toBe(7);
        expect(slim.viewer_stats).toEqual({ live_viewers: 3 });
        for (const dropped of ['description', 'stream_source', 'external_hls_url',
            'external_stream_url', 'external_use_proxy', 'availability_reason']) {
            expect(slim).not.toHaveProperty(dropped);
        }
    });

    it('slim list never carries a stream URL field even when upstream had one', () => {
        const slim = slimLandingCamera({
            id: 9, name: 'B',
            external_hls_url: 'https://u:p@origin/x.m3u8',
            external_stream_url: 'https://u:p@origin/x.m3u8',
        });
        expect(slim.external_hls_url).toBeUndefined();
        expect(slim.external_stream_url).toBeUndefined();
    });
});

describe('pickFirstGridCamera (SSI LCP pick)', () => {
    const areas = [
        { name: 'DS DANDER', show_on_grid_default: 1, grid_default_camera_limit: 10 },
        { name: 'KEDUNGDUNG', show_on_grid_default: 0, grid_default_camera_limit: 12 },
    ];
    const cameras = [
        { id: 1, name: 'X NOAREA', area_name: 'ELSEWHERE', is_online: 1 },
        { id: 5, name: 'Z OFFLINE', area_name: 'DS DANDER', is_online: 0 },
        { id: 2, name: 'A ONLINE B', area_name: 'DS DANDER', is_online: 1 },
        { id: 3, name: 'A ONLINE A', area_name: 'DS DANDER', is_online: 1 },
        { id: 4, name: 'K1', area_name: 'KEDUNGDUNG', is_online: 1 },
    ];

    it('picks the online-first/name-asc head of the earliest flagged area', () => {
        // Mirrors gridAreaScopedCameras: group order = first camera-list occurrence of the
        // flagged area; head sorted online desc, name asc.
        expect(pickFirstGridCamera(cameras, areas).id).toBe(3);
    });

    it('ignores non-flagged areas even if they occur first', () => {
        const unflaggedOnly = [
            { id: 9, name: 'K9', area_name: 'KEDUNGDUNG', is_online: 1 },
        ];
        expect(pickFirstGridCamera(unflaggedOnly, areas).id).toBe(9); // falls back to raw order
    });

    it('falls back to raw API order when no flagged area exists', () => {
        expect(pickFirstGridCamera(cameras, [{ name: 'NONE', show_on_grid_default: 0 }]).id).toBe(1);
        expect(pickFirstGridCamera(cameras, []).id).toBe(1);
    });

    it('returns null on an empty camera list', () => {
        expect(pickFirstGridCamera([], areas)).toBeNull();
        expect(pickFirstGridCamera(null, areas)).toBeNull();
    });
});

describe('buildLcpCardFragment (SSI LCP img)', () => {
    it('emits a full <img> with ?v= version token for /api/thumbnails paths', () => {
        const html = buildLcpCardFragment({
            name: 'CCTV <ALANG>', thumbnail_path: '/api/thumbnails/1168.jpg',
            thumbnail_updated_at: '2026-09-25 10:00:00', external_snapshot_url: null,
        });
        expect(html).toContain('id="boot-lcp-img"');
        expect(html).toContain('src="/api/thumbnails/1168.jpg?v=2026-09-25%2010%3A00%3A00"');
        expect(html).toContain('fetchpriority="high"');
        expect(html).toContain('alt="CCTV &lt;ALANG&gt; preview"');
        expect(html).not.toContain('display:none');
    });

    it('prefers external_snapshot_url (no ?v= appended to absolute URLs)', () => {
        const html = buildLcpCardFragment({
            name: 'X', external_snapshot_url: 'https://snap.example/x.jpg',
            thumbnail_path: '/api/thumbnails/9.jpg', thumbnail_updated_at: 't',
        });
        expect(html).toContain('src="https://snap.example/x.jpg"');
        expect(html).not.toContain('?v=');
    });

    it('returns empty string when the camera has no imageable field', () => {
        expect(buildLcpCardFragment({ name: 'X' })).toBe('');
        expect(buildLcpCardFragment(null)).toBe('');
    });

    it('escapes attribute-breaking characters in name and URL', () => {
        const html = buildLcpCardFragment({
            name: 'A"B', thumbnail_path: '/api/thumbnails/1.jpg?x="q"',
        });
        expect(html).toContain('alt="A&quot;B preview"');
        expect(html).toContain('src="/api/thumbnails/1.jpg?x=&quot;q&quot;"');
    });
});
