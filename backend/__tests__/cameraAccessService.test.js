/**
 * Purpose: Verify the tenancy access decision matrix (community/owner_private/subscriber)
 *          and the subscriber billing gate used by all stream-serving surfaces.
 * Caller: Backend focused test gate for cameraAccessService.
 * Deps: vitest, mocked connectionPool.
 * MainFuncs: canViewLive matrix tests, access-info cache behavior.
 * SideEffects: Mocks database calls only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryOneMock } = vi.hoisted(() => ({
    queryOneMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: vi.fn(),
    queryOne: (...args) => queryOneMock(...args),
    execute: vi.fn(),
}));

const { voucherMock } = vi.hoisted(() => ({
    voucherMock: {
        isAreaAccessGated: vi.fn(() => false),
        hasAreaAccess: vi.fn(() => false),
    },
}));

vi.mock('../services/voucherService.js', () => ({ default: voucherMock }));

import {
    getAccessInfo,
    getAccessInfoByStreamKey,
    canViewLive,
    isPublicCamera,
    invalidateCameraAccessCache,
} from '../services/cameraAccessService.js';

function cameraRow(overrides = {}) {
    return {
        id: 7,
        stream_key: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        enabled: 1,
        owner_user_id: 42,
        camera_class: 'subscriber',
        billing_status: 'active',
        ...overrides,
    };
}

describe('cameraAccessService', () => {
    beforeEach(() => {
        queryOneMock.mockReset();
        invalidateCameraAccessCache();
        voucherMock.isAreaAccessGated.mockReset();
        voucherMock.isAreaAccessGated.mockReturnValue(false);
        voucherMock.hasAreaAccess.mockReset();
        voucherMock.hasAreaAccess.mockReturnValue(false);
    });

    describe('voucher area-gate (overlay on public-by-class cameras)', () => {
        const communityInfo = { ...cameraRow({ camera_class: 'community', owner_user_id: null, area_id: 5 }), enabled: true };

        it('is inert when the area is not voucher-gated — community stays public', () => {
            voucherMock.isAreaAccessGated.mockReturnValue(false);
            const r = canViewLive({ info: communityInfo, user: null });
            expect(r.allowed).toBe(true);
            expect(r.voucherGated).toBe(false);
            expect(voucherMock.hasAreaAccess).not.toHaveBeenCalled();
        });

        it('blocks an anonymous viewer without a pass (402 voucher_required)', () => {
            voucherMock.isAreaAccessGated.mockReturnValue(true);
            voucherMock.hasAreaAccess.mockReturnValue(false);
            const r = canViewLive({ info: communityInfo, user: null, voucherDeviceHash: 'dev-x' });
            expect(r.allowed).toBe(false);
            expect(r.statusCode).toBe(402);
            expect(r.reason).toBe('voucher_required');
            expect(r.voucherGated).toBe(true);
        });

        it('allows a device that holds an active pass for the area', () => {
            voucherMock.isAreaAccessGated.mockReturnValue(true);
            voucherMock.hasAreaAccess.mockReturnValue(true);
            const r = canViewLive({ info: communityInfo, user: null, voucherDeviceHash: 'dev-pass' });
            expect(r.allowed).toBe(true);
            expect(r.voucherGated).toBe(true);
            expect(voucherMock.hasAreaAccess).toHaveBeenCalledWith(5, { deviceHash: 'dev-pass' });
        });

        it('blocks when no device hash is present even though the area is gated', () => {
            voucherMock.isAreaAccessGated.mockReturnValue(true);
            const r = canViewLive({ info: communityInfo, user: null, voucherDeviceHash: null });
            expect(r.allowed).toBe(false);
            expect(r.statusCode).toBe(402);
        });

        it('lets staff bypass the voucher gate', () => {
            voucherMock.isAreaAccessGated.mockReturnValue(true);
            voucherMock.hasAreaAccess.mockReturnValue(false);
            const r = canViewLive({ info: communityInfo, user: { id: 1, role: 'admin' } });
            expect(r.allowed).toBe(true);
            expect(r.voucherGated).toBe(true);
        });

        it('also gates a published-public subscriber camera in a gated area', () => {
            voucherMock.isAreaAccessGated.mockReturnValue(true);
            voucherMock.hasAreaAccess.mockReturnValue(false);
            const info = { ...cameraRow({ is_public: true, billing_status: 'active', area_id: 5 }), enabled: true };
            const r = canViewLive({ info, user: null, voucherDeviceHash: 'dev-x' });
            expect(r.allowed).toBe(false);
            expect(r.statusCode).toBe(402);
            expect(r.reason).toBe('voucher_required');
        });

        it('does not consult the voucher service for a camera with no area', () => {
            voucherMock.isAreaAccessGated.mockReturnValue(true);
            const info = { ...cameraRow({ camera_class: 'community', owner_user_id: null, area_id: null }), enabled: true };
            const r = canViewLive({ info, user: null });
            expect(r.allowed).toBe(true);
            expect(r.voucherGated).toBe(false);
            expect(voucherMock.isAreaAccessGated).not.toHaveBeenCalled();
        });
    });

    describe('canViewLive decision matrix', () => {
        it('always allows community cameras, even anonymously', () => {
            const info = { ...cameraRow({ camera_class: 'community', owner_user_id: null }), enabled: true };
            expect(canViewLive({ info, user: null }).allowed).toBe(true);
        });

        it('denies anonymous viewers on owner_private cameras', () => {
            const info = { ...cameraRow({ camera_class: 'owner_private' }), enabled: true };
            const result = canViewLive({ info, user: null });
            expect(result.allowed).toBe(false);
            expect(result.statusCode).toBe(403);
        });

        it('allows the owner on owner_private cameras', () => {
            const info = { ...cameraRow({ camera_class: 'owner_private' }), enabled: true };
            expect(canViewLive({ info, user: { id: 42, role: 'customer' } }).allowed).toBe(true);
        });

        it('denies a different customer on owner_private cameras', () => {
            const info = { ...cameraRow({ camera_class: 'owner_private' }), enabled: true };
            const result = canViewLive({ info, user: { id: 99, role: 'customer' } });
            expect(result.allowed).toBe(false);
            expect(result.statusCode).toBe(403);
        });

        it('allows staff (admin and viewer) on any camera, including suspended subscribers', () => {
            const info = { ...cameraRow({ billing_status: 'suspended' }), enabled: true };
            expect(canViewLive({ info, user: { id: 1, role: 'admin' } }).allowed).toBe(true);
            expect(canViewLive({ info, user: { id: 2, role: 'viewer' } }).allowed).toBe(true);
        });

        it('allows the owner on an active subscriber camera', () => {
            const info = { ...cameraRow(), enabled: true };
            expect(canViewLive({ info, user: { id: 42, role: 'customer' } }).allowed).toBe(true);
        });

        it('returns 402 for the owner when the subscriber camera is suspended', () => {
            const info = { ...cameraRow({ billing_status: 'suspended' }), enabled: true };
            const result = canViewLive({ info, user: { id: 42, role: 'customer' } });
            expect(result.allowed).toBe(false);
            expect(result.statusCode).toBe(402);
            expect(result.reason).toBe('subscription_suspended');
        });

        it('accepts a camera-bound stream token instead of a user', () => {
            const info = { ...cameraRow(), enabled: true };
            expect(canViewLive({ info, streamToken: { cameraId: 7 } }).allowed).toBe(true);
        });

        it('rejects a stream token bound to a different camera', () => {
            const info = { ...cameraRow(), enabled: true };
            const result = canViewLive({ info, streamToken: { cameraId: 8 } });
            expect(result.allowed).toBe(false);
            expect(result.statusCode).toBe(403);
        });

        it('rejects a valid token on a suspended subscriber camera with 402', () => {
            const info = { ...cameraRow({ billing_status: 'suspended' }), enabled: true };
            const result = canViewLive({ info, streamToken: { cameraId: 7 } });
            expect(result.allowed).toBe(false);
            expect(result.statusCode).toBe(402);
        });

        it('returns 404 for missing or disabled cameras', () => {
            expect(canViewLive({ info: null }).statusCode).toBe(404);
            const disabled = { ...cameraRow(), enabled: false };
            expect(canViewLive({ info: disabled, user: { id: 42, role: 'customer' } }).statusCode).toBe(404);
        });
    });

    describe('published subscriber cameras (is_public toggle)', () => {
        it('allows ANYONE (anonymous) on a published, actively-paid subscriber camera', () => {
            const info = { ...cameraRow({ is_public: true, billing_status: 'active' }), enabled: true };
            expect(canViewLive({ info, user: null }).allowed).toBe(true);
            expect(isPublicCamera(info)).toBe(true);
        });

        it('hides a published camera from the public the moment it suspends', () => {
            const info = { ...cameraRow({ is_public: true, billing_status: 'suspended' }), enabled: true };
            expect(canViewLive({ info, user: null }).allowed).toBe(false); // anonymous can no longer see it
            expect(isPublicCamera(info)).toBe(false);
            // Owner still reaches it to learn it's suspended (402).
            expect(canViewLive({ info, user: { id: 42, role: 'customer' } }).statusCode).toBe(402);
        });

        it('keeps a PRIVATE subscriber camera hidden from anonymous viewers', () => {
            const info = { ...cameraRow({ is_public: false, billing_status: 'active' }), enabled: true };
            const result = canViewLive({ info, user: null });
            expect(result.allowed).toBe(false);
            expect(result.statusCode).toBe(403);
            expect(isPublicCamera(info)).toBe(false);
        });

        it('normalizeInfo maps is_public 1 → true through getAccessInfo', () => {
            queryOneMock.mockReturnValue(cameraRow({ is_public: 1, billing_status: 'active' }));
            const info = getAccessInfo(7);
            expect(info.is_public).toBe(true);
            expect(canViewLive({ info, user: null }).allowed).toBe(true);
        });
    });

    describe('access info lookup + cache', () => {
        it('normalizes unknown classes to community and caches by id', () => {
            queryOneMock.mockReturnValue(cameraRow({ camera_class: 'weird_value' }));
            const info = getAccessInfo(7);
            expect(info.camera_class).toBe('community');
            expect(isPublicCamera(info)).toBe(true);

            getAccessInfo(7);
            expect(queryOneMock).toHaveBeenCalledTimes(1); // cache hit on second call
        });

        it('looks up by stream key and shares the cache with id lookups', () => {
            queryOneMock.mockReturnValue(cameraRow());
            const info = getAccessInfoByStreamKey('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
            expect(info.id).toBe(7);

            getAccessInfo(7);
            expect(queryOneMock).toHaveBeenCalledTimes(1);
        });

        it('invalidation forces a fresh read (billing transitions hit streams fast)', () => {
            queryOneMock.mockReturnValueOnce(cameraRow());
            expect(getAccessInfo(7).billing_status).toBe('active');

            invalidateCameraAccessCache(7);
            queryOneMock.mockReturnValueOnce(cameraRow({ billing_status: 'suspended' }));
            expect(getAccessInfo(7).billing_status).toBe('suspended');
        });

        it('rejects invalid ids without touching the database', () => {
            expect(getAccessInfo('abc')).toBe(null);
            expect(getAccessInfo(-1)).toBe(null);
            expect(getAccessInfoByStreamKey('')).toBe(null);
            expect(queryOneMock).not.toHaveBeenCalled();
        });
    });
});
