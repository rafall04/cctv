/**
 * Purpose: Focused regression tests for API key public/protected endpoint classification.
 * Caller: Vitest backend verification for middleware security routing.
 * Deps: ../middleware/apiKeyValidator.js.
 * MainFuncs: isPublicEndpoint public growth whitelist coverage.
 * SideEffects: None; test-only assertions.
 */

import { describe, expect, it } from 'vitest';
import { isPublicEndpoint } from '../middleware/apiKeyValidator.js';

describe('apiKeyValidator public endpoint classification', () => {
    it('treats public growth endpoints as public reads', () => {
        expect(isPublicEndpoint('/api/public/areas/kab-surabaya')).toBe(true);
        expect(isPublicEndpoint('/api/public/areas/kab-surabaya/cameras?page=1')).toBe(true);
        expect(isPublicEndpoint('/api/public/trending-cameras?limit=4')).toBe(true);
    });

    it('keeps protected admin endpoints behind API key validation', () => {
        expect(isPublicEndpoint('/api/admin/dashboard')).toBe(false);
    });

    // Every path an anonymous visitor (or token-holder without an account) legitimately
    // calls. If the API-key layer is ever enabled with requireKeys, an endpoint missing
    // here 403s a working public feature — pin the whole surface so whitelist rot fails
    // loudly instead of silently locking users out.
    it('keeps every legitimately anonymous surface reachable without an API key', () => {
        const anonymous = [
            '/health',
            '/api/auth/csrf',
            '/api/auth/login',
            '/api/auth/register',
            '/api/auth/register-info',
            '/api/auth/refresh',
            '/api/auth/totp/verify',
            '/api/cameras/active',
            '/api/areas/public',
            '/api/areas/filters',
            '/api/stream/1',
            '/api/stream/1/token',
            '/api/stream/1/external.m3u8',
            '/hls/some-uuid/index.m3u8',
            '/api/thumbnails/1.jpg',
            '/api/settings/map-center',
            '/api/settings/landing-page',
            '/api/settings/public-ads',
            '/api/settings/timezone',
            '/api/branding/public',
            '/api/config/public',
            '/api/config/version',
            '/api/config/manifest',
            '/api/saweria/config',
            '/api/sponsors/active',
            '/api/sponsors/cameras',
            '/api/promo-banners/public',
            '/api/promo-banners/7/click',
            '/api/promo-media/poster.jpg',
            '/api/affiliate-media/product.jpg',
            '/api/viewer/start',
            '/api/viewer/heartbeat',
            '/api/viewer/stop',
            '/api/viewer/runtime-signal',
            '/api/playback-viewer/start',
            '/api/playback-viewer/heartbeat',
            '/api/playback-viewer/stop',
            '/api/playback-token/activate',
            '/api/playback-token/heartbeat',
            '/api/playback-token/clear',
            '/api/playback-archive/123/stream',
            '/api/recordings/1/segments',
            '/api/recordings/1/playlist.m3u8',
            '/api/recordings/1/stream/seg.mp4',
            '/api/recordings/archive/9/stream',
            '/api/voucher/access',
            '/api/voucher/redeem',
            '/api/voucher/order',
            '/api/voucher/order/5/status',
            '/api/voucher/webhook/ipaymu',
            '/api/public/discovery',
            '/api/public/trending-cameras',
            '/api/public/affiliate/offer',
            '/api/public/slot',
            '/api/public/support-reach',
            '/api/playback-access/products',
            '/api/playback-access/order',
            '/api/billing/webhook/ipaymu',
            '/api/internal/mediamtx-hook',
            '/api/feedback',
            // Bootstrap path: mint the first key when the table is empty (admin JWT still applies).
            '/api/admin/api-keys',
        ];
        for (const url of anonymous) {
            expect(isPublicEndpoint(url), url).toBe(true);
        }
    });

    it('keeps every non-public endpoint behind API key validation', () => {
        const protectedUrls = [
            '/api/admin/dashboard',
            '/api/admin/api-keys/5', // DELETE /:id — only the bare mint/list path is exempt
            '/api/cameras',
            '/api/cameras/1',
            '/api/users',
            '/api/areas',
            '/api/areas/1',
            '/api/settings',
            '/api/settings/landing-banner',
            '/api/viewer/active',
            '/api/viewer/stats',
            '/api/playback-viewer/stats',
            '/api/playback-viewer/analytics',
            '/api/customer/cameras',
            '/api/customer/wallet',
            '/api/feedback/stats',
            '/api/sponsors/1',
            '/api/saweria/settings',
            '/api/auth/logout',
            '/api/auth/verify',
        ];
        for (const url of protectedUrls) {
            expect(isPublicEndpoint(url), url).toBe(false);
        }
    });
});
