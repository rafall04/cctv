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
    PROXIED_ORIGIN_URL_FIELDS,
    PUBLIC_LANDING_INTERNAL_FIELDS,
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
