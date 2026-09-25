/**
 * Purpose: Pin the FOUR gates of the public archive segment gate — the strictest privacy
 *          boundary in the project (community-only, anti-enumeration 404s, window check).
 * Caller: Backend test gate.
 * Deps: vitest, vi.mock of connectionPool + playbackTokenService; REAL resolveAccessBounds.
 * MainFuncs: resolveSegmentForRequest.
 * SideEffects: none — connectionPool is fully mocked.
 *
 * This service had zero direct coverage while being the only thing standing between a public
 * playback token and subscriber/owner-private footage. A silent regression here leaks archives.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryOne = vi.fn();
vi.mock('../database/connectionPool.js', () => ({ queryOne: (...a) => queryOne(...a) }));

const validateRequestForCamera = vi.fn();
vi.mock('../services/playbackTokenService.js', () => ({
    default: { validateRequestForCamera: (...a) => validateRequestForCamera(...a) },
}));

const { default: publicArchiveAccessService } = await import('../services/publicArchiveAccessService.js');

const COMMUNITY_ROW = {
    segment_id: 10, camera_id: 7, filename: '20260101_120000.mp4', file_size: 1000,
    file_id: 'tg-file-id', recorded_at: '2026-08-02 12:00:00',
    camera_id_ref: 7, area_id: 3, camera_class: 'community', public_playback_mode: null, enabled: 1,
};
const ACCESS = { id: 42, playback_window_hours: null, playback_from: null, playback_to: null };
const REQ = { headers: {}, query: {}, ip: '127.0.0.1' };

beforeEach(() => {
    vi.clearAllMocks();
    queryOne.mockReturnValue(COMMUNITY_ROW);
    validateRequestForCamera.mockReturnValue(ACCESS);
});

describe('gate 1 — segment must exist, uploaded ok, with a file_id', () => {
    it('404s on non-integer and non-positive ids before touching the DB', () => {
        // '1.5' is deliberately absent: parseInt('1.5')→1 reaches the DB — the route schema
        // (segmentId: type integer) owns rejecting non-integers before this service runs.
        for (const bad of ['abc', '-1', '0']) {
            expect(() => publicArchiveAccessService.resolveSegmentForRequest(bad, REQ))
                .toThrowError(expect.objectContaining({ statusCode: 404 }));
        }
        expect(queryOne).not.toHaveBeenCalled();
    });

    it('404s when the row is absent or has no Telegram file_id', () => {
        queryOne.mockReturnValue(undefined);
        expect(() => publicArchiveAccessService.resolveSegmentForRequest('10', REQ))
            .toThrowError(expect.objectContaining({ statusCode: 404 }));

        queryOne.mockReturnValue({ ...COMMUNITY_ROW, file_id: null });
        expect(() => publicArchiveAccessService.resolveSegmentForRequest('10', REQ))
            .toThrowError(expect.objectContaining({ statusCode: 404 }));
    });
});

describe('gate 2 — community-only, and enumeration-resistant', () => {
    it.each(['owner_private', 'subscriber'])('404s (not 403) on camera_class=%s', (cls) => {
        queryOne.mockReturnValue({ ...COMMUNITY_ROW, camera_class: cls });
        try {
            publicArchiveAccessService.resolveSegmentForRequest('10', REQ);
            expect.unreachable('must throw');
        } catch (e) {
            // A 403 would confirm the segment EXISTS — the gate must answer exactly like a miss.
            expect(e.statusCode).toBe(404);
            expect(e.message).toBe('Segment tidak ditemukan');
        }
    });

    it('404s on a disabled community camera — the off-switch retires the archive too', () => {
        queryOne.mockReturnValue({ ...COMMUNITY_ROW, enabled: 0 });
        expect(() => publicArchiveAccessService.resolveSegmentForRequest('10', REQ))
            .toThrowError(expect.objectContaining({ statusCode: 404 }));
    });
});

describe('gate 3 — playback token must cover the camera', () => {
    it('401s when no valid credential is presented', () => {
        validateRequestForCamera.mockReturnValue(null);
        expect(() => publicArchiveAccessService.resolveSegmentForRequest('10', REQ))
            .toThrowError(expect.objectContaining({ statusCode: 401 }));
    });

    it('propagates the validator throw (expired/revoked token)', () => {
        validateRequestForCamera.mockImplementation(() => {
            const e = new Error('revoked'); e.statusCode = 403; throw e;
        });
        expect(() => publicArchiveAccessService.resolveSegmentForRequest('10', REQ))
            .toThrowError(expect.objectContaining({ statusCode: 403 }));
    });

    it('passes the REAL camera row to the validator (area tokens need area_id)', () => {
        publicArchiveAccessService.resolveSegmentForRequest('10', REQ);
        expect(validateRequestForCamera).toHaveBeenCalledWith(
            REQ, 7,
            expect.objectContaining({
                camera: expect.objectContaining({ id: 7, area_id: 3, camera_class: 'community' }),
            })
        );
    });
});

describe('gate 4 — segment inside the token window', () => {
    it('403s when recorded_at is older than the rolling window floor', () => {
        // recorded 2026-08-02 12:00 UTC; a 1-hour token floor is far newer than that.
        validateRequestForCamera.mockReturnValue({ ...ACCESS, playback_window_hours: 1 });
        expect(() => publicArchiveAccessService.resolveSegmentForRequest('10', REQ))
            .toThrowError(expect.objectContaining({ statusCode: 403 }));
    });

    it('403s when recorded_at reaches the absolute window end (half-open bound)', () => {
        validateRequestForCamera.mockReturnValue({
            ...ACCESS, playback_from: '2026-08-02T00:00:00Z', playback_to: '2026-08-02T12:00:00Z',
        });
        expect(() => publicArchiveAccessService.resolveSegmentForRequest('10', REQ))
            .toThrowError(expect.objectContaining({ statusCode: 403 }));
    });

    it('403s when recorded_at is unparseable — unknown time cannot prove entitlement', () => {
        queryOne.mockReturnValue({ ...COMMUNITY_ROW, recorded_at: 'not-a-date' });
        validateRequestForCamera.mockReturnValue({ ...ACCESS, playback_window_hours: 720 });
        expect(() => publicArchiveAccessService.resolveSegmentForRequest('10', REQ))
            .toThrowError(expect.objectContaining({ statusCode: 403 }));
    });

    it('passes when recorded_at sits inside the absolute window', () => {
        validateRequestForCamera.mockReturnValue({
            ...ACCESS, playback_from: '2026-08-02T00:00:00Z', playback_to: '2026-08-03T00:00:00Z',
        });
        const out = publicArchiveAccessService.resolveSegmentForRequest('10', REQ);
        expect(out.segmentId).toBe(10);
        expect(out.tokenId).toBe(42);
    });
});

describe('shape of the granted result', () => {
    it('returns ids only — never the Telegram file_id (the route streams through us)', () => {
        const out = publicArchiveAccessService.resolveSegmentForRequest('10', REQ);
        expect(out).toMatchObject({ segmentId: 10, cameraId: 7, filename: '20260101_120000.mp4', tokenId: 42 });
        expect(out).not.toHaveProperty('file_id');
        expect(JSON.stringify(out)).not.toContain('tg-file-id');
    });
});
