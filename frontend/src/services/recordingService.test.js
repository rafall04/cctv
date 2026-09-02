/*
 * Purpose: Validate segment stream URL routing — the split between local, public-archive,
 *          admin-archive, and owner-archive endpoints. Regression cover for the bug where admin playback of archived
 *          (Telegram) segments hit the public token route and 401'd, so past dates showed a full
 *          segment list whose videos would not play.
 * Caller: Vitest frontend suite.
 * Deps: recordingService.getSegmentStreamUrl with config/apiClient mocked.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({ default: {} }));
vi.mock('../config/config.js', () => ({
    getApiUrl: () => 'https://cctv.example',
}));
vi.mock('./requestPolicy', () => ({
    getRequestPolicyConfig: () => ({}),
    REQUEST_POLICY: {},
}));

const { getSegmentStreamUrl } = await import('./recordingService.js');

describe('getSegmentStreamUrl', () => {
    it('routes a local (non-archive) segment to the recordings stream endpoint', () => {
        const url = getSegmentStreamUrl(15, '20260808_120000.mp4', 'admin_full', { source: 'local' });
        expect(url).toBe('https://cctv.example/api/recordings/15/stream/20260808_120000.mp4?scope=admin');
    });

    it('routes an ADMIN archive segment to the admin library route (JWT-cookie auth), not the token route', () => {
        const url = getSegmentStreamUrl(15, '20260808_120000.mp4', 'admin_full', { source: 'archive', id: 987 });
        expect(url).toBe('https://cctv.example/api/admin/telegram-archive/library/987/stream');
    });

    it('routes a PUBLIC archive segment to the public playback-archive route (token-cookie auth)', () => {
        const url = getSegmentStreamUrl(15, '20260808_120000.mp4', 'public_preview', { source: 'archive', id: 987 });
        expect(url).toBe('https://cctv.example/api/playback-archive/987/stream');
    });

    it('routes an OWNER archive segment to the authenticated owner-archive route (Audit P-01)', () => {
        // The owner (subscriber camera, JWT, no playback token) must NOT hit the public archive route:
        // it requires community-class + a token cookie and 401/404'd on their own footage. Server
        // re-checks ownership + billing via ?scope=owner.
        const url = getSegmentStreamUrl(15, '20260808_120000.mp4', 'owner_full', { source: 'archive', id: 987 });
        expect(url).toBe('https://cctv.example/api/recordings/archive/987/stream?scope=owner');
    });
});
