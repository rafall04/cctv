// @vitest-environment jsdom

/*
 * Purpose: Verify public playback token activation exposes camera entitlement metadata.
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
    });

    it('activates share key with current camera id and exposes allowed cameras', async () => {
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
        expect(playbackTokenService.activateShareKey).toHaveBeenCalledWith('CLIENT88', 3, expect.any(String));
        expect(setSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true });
    });
});
