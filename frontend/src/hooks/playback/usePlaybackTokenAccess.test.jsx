// @vitest-environment jsdom

/*
 * Purpose: Verify public playback token activation exposes camera entitlement metadata without owning route cleanup.
 * Caller: Frontend Vitest suite for playback token access hook.
 * Deps: React Testing Library renderHook and mocked playbackTokenService.
 * MainFuncs: usePlaybackTokenAccess.
 * SideEffects: Uses jsdom localStorage only.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackTokenAccess } from './usePlaybackTokenAccess.js';
import playbackTokenService from '../../services/playbackTokenService.js';

vi.mock('../../services/playbackTokenService.js', () => ({
    default: {
        activateShareKey: vi.fn(),
        activateToken: vi.fn(),
        heartbeatToken: vi.fn(),
        clearToken: vi.fn(),
    },
}));

describe('usePlaybackTokenAccess', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        // Every mount now asks the cookie who it is; these tests are about other things.
        playbackTokenService.heartbeatToken.mockResolvedValue({ success: false });
    });

    it('activates a share key WITHOUT a camera, and exposes the cameras it allows', async () => {
        const setSearchParams = vi.fn();
        playbackTokenService.activateShareKey.mockResolvedValue({
            success: true,
            data: {
                id: 8,
                scope_type: 'selected',
                allowed_camera_ids: [3],
                camera_rules: [{ camera_id: 3, enabled: true, playback_window_hours: 24 }],
                default_camera_id: 3,
            },
        });
        const onActivated = vi.fn();

        const { result } = renderHook(() => usePlaybackTokenAccess({
            enabled: true,
            searchParams: new URLSearchParams('cam=3&share=CLIENT88'),
            setSearchParams,
            cameraId: 3,
            onActivated,
        }));

        await waitFor(() => expect(result.current.tokenStatus?.allowed_camera_ids).toEqual([3]));
        expect(result.current.allowedCameraIds).toEqual([3]);
        expect(result.current.cameraRules).toEqual([{ camera_id: 3, enabled: true, playback_window_hours: 24 }]);
        expect(result.current.defaultCameraId).toBe(3);
        expect(onActivated).toHaveBeenCalledWith(expect.objectContaining({
            default_camera_id: 3,
            allowed_camera_ids: [3],
        }));
        // No camera id. A share link grants the token's whole set; tying activation to whichever
        // camera happened to be selected made an area-scoped link fail outright when the page
        // opened on a camera outside that area. Per-camera scope is still enforced on every
        // segment and stream request.
        expect(playbackTokenService.activateShareKey).toHaveBeenCalledWith('CLIENT88', null, expect.any(String));
        // And exactly once — the effect used to re-run when the camera list loaded, so the second
        // attempt's failure overwrote the first attempt's success.
        expect(playbackTokenService.activateShareKey).toHaveBeenCalledTimes(1);
        expect(setSearchParams).not.toHaveBeenCalled();
    });
});

/*
 * The share key is now KEPT in the URL so a link survives a lost cookie. That makes signing out a
 * two-part job: without stripping the param, the next reload would re-activate the very token the
 * visitor just left, and "Keluar" would silently do nothing.
 */
describe('usePlaybackTokenAccess sign-out', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        playbackTokenService.heartbeatToken.mockResolvedValue({ success: false });
    });

    const clearWith = async (search) => {
        const setSearchParams = vi.fn();
        playbackTokenService.clearToken.mockResolvedValue({ success: true });
        const onCleared = vi.fn();

        const { result } = renderHook(() => usePlaybackTokenAccess({
            enabled: true,
            searchParams: new URLSearchParams(search),
            setSearchParams,
            cameraId: 3,
            onActivated: vi.fn(),
            onCleared,
        }));

        await result.current.clearToken();
        return { setSearchParams, onCleared };
    };

    it('drops the share key from the URL, so the sign-out survives a reload', async () => {
        // No key in the URL here: activating on mount would fight the clear under test.
        const { setSearchParams } = await clearWith('cam=3-gate&mode=full');

        expect(playbackTokenService.clearToken).toHaveBeenCalled();
        const [updater, options] = setSearchParams.mock.calls[0];
        // Replace, not push — signing out should not leave a Back button that re-grants access.
        expect(options).toMatchObject({ replace: true });

        const next = updater(new URLSearchParams('share=BJNKUUU&token=rafpb_x&cam=3-gate&mode=full'));
        expect(next.get('share')).toBeNull();
        expect(next.get('token')).toBeNull();
        // Everything unrelated survives: the visitor stays on the camera they were watching.
        expect(next.get('cam')).toBe('3-gate');
        expect(next.get('mode')).toBe('full');
    });

    it('still tells the page access is gone, so segments reload as an anonymous visitor', async () => {
        const { onCleared } = await clearWith('cam=3-gate');

        expect(onCleared).toHaveBeenCalledTimes(1);
    });

    it('does not fall over when the caller supplied no setSearchParams', async () => {
        playbackTokenService.clearToken.mockResolvedValue({ success: true });
        const onCleared = vi.fn();

        const { result } = renderHook(() => usePlaybackTokenAccess({
            enabled: true,
            searchParams: new URLSearchParams('cam=3'),
            cameraId: 3,
            onActivated: vi.fn(),
            onCleared,
        }));

        await result.current.clearToken();

        expect(onCleared).toHaveBeenCalledTimes(1);
    });
});

/*
 * A visitor arriving WITHOUT a key in the URL — the landing page, a second visit, any internal
 * navigation — held a valid token the UI knew nothing about: the panel showed no label, no
 * coverage, no expiry, and offered a free trial to someone who had already paid.
 */
describe('usePlaybackTokenAccess cookie hydration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
    });

    const mount = (search = '') => renderHook(() => usePlaybackTokenAccess({
        enabled: true,
        searchParams: new URLSearchParams(search),
        setSearchParams: vi.fn(),
        cameraId: 3,
        onActivated: vi.fn(),
        onCleared: vi.fn(),
    }));

    it('asks the cookie who it is and adopts the answer', async () => {
        playbackTokenService.heartbeatToken.mockResolvedValue({
            success: true,
            data: { id: 9, label: 'BJN', scope_type: 'area', allowed_camera_ids: [1, 2] },
        });

        const { result } = mount();

        await waitFor(() => {
            expect(result.current.tokenStatus).toMatchObject({ label: 'BJN', allowed_camera_ids: [1, 2] });
        });
    });

    it('stays silent for a visitor with no cookie — that is anonymous, not an error', async () => {
        const denied = new Error('Token playback tidak aktif');
        denied.response = { status: 401, data: { message: 'Token playback tidak aktif' } };
        playbackTokenService.heartbeatToken.mockRejectedValue(denied);

        const { result } = mount();

        await waitFor(() => expect(playbackTokenService.heartbeatToken).toHaveBeenCalled());
        expect(result.current.tokenStatus).toBeNull();
        expect(result.current.tokenMessage).toBe('');
    });

    it('asks only once, however often the hook re-renders', async () => {
        playbackTokenService.heartbeatToken.mockResolvedValue({ success: true, data: { id: 9 } });

        const { rerender } = mount();
        rerender();
        rerender();

        await waitFor(() => expect(playbackTokenService.heartbeatToken).toHaveBeenCalledTimes(1));
    });

    it('does not overwrite an activation that won the race', async () => {
        // The share key activates with the authoritative payload; a slower hydrate must not clobber it.
        playbackTokenService.activateShareKey.mockResolvedValue({
            success: true, data: { id: 9, label: 'DARI AKTIVASI' },
        });
        let resolveHeartbeat;
        playbackTokenService.heartbeatToken.mockReturnValue(new Promise((r) => { resolveHeartbeat = r; }));

        const { result } = mount('share=BJNKUUU');
        await waitFor(() => expect(result.current.tokenStatus?.label).toBe('DARI AKTIVASI'));

        resolveHeartbeat({ success: true, data: { id: 9, label: 'DARI HEARTBEAT' } });
        await waitFor(() => expect(result.current.tokenStatus?.label).toBe('DARI AKTIVASI'));
    });
});
