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
