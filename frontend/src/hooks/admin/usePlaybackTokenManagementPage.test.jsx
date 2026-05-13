// @vitest-environment jsdom

/*
 * Purpose: Verify playback token management hook payload shaping for camera entitlement rules.
 * Caller: Frontend Vitest suite for admin playback token management.
 * Deps: React Testing Library renderHook, mocked playbackTokenService, mocked cameraService, mocked notification/timezone contexts.
 * MainFuncs: usePlaybackTokenManagementPage.
 * SideEffects: None; service calls are mocked.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    cameraMatchesPlaybackTokenSearch,
    extractPlaybackTokenShareText,
    usePlaybackTokenManagementPage,
} from './usePlaybackTokenManagementPage.js';
import playbackTokenService from '../../services/playbackTokenService.js';

const notifySuccessMock = vi.fn();
const notifyErrorMock = vi.fn();

vi.mock('../../services/playbackTokenService.js', () => ({
    default: {
        listTokens: vi.fn(),
        listAuditLogs: vi.fn(),
        createToken: vi.fn(),
        updateToken: vi.fn(),
        shareToken: vi.fn(),
        clearSessions: vi.fn(),
        revokeToken: vi.fn(),
    },
}));

vi.mock('../../services/cameraService', () => ({
    cameraService: {
        getAllCameras: vi.fn(),
    },
}));

vi.mock('../../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success: notifySuccessMock,
        error: notifyErrorMock,
    }),
}));

vi.mock('../../contexts/TimezoneContext', () => ({
    TIMESTAMP_STORAGE: { UTC_SQL: 'utc_sql' },
    useTimezone: () => ({
        formatDateTime: (value) => value || 'Selamanya',
    }),
}));

function submitEvent() {
    return { preventDefault: vi.fn() };
}

describe('usePlaybackTokenManagementPage', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { cameraService } = await import('../../services/cameraService');
        playbackTokenService.listTokens.mockResolvedValue({ data: [] });
        playbackTokenService.listAuditLogs.mockResolvedValue({ data: [] });
        playbackTokenService.createToken.mockResolvedValue({ share_text: 'share text' });
        playbackTokenService.updateToken.mockResolvedValue({ success: true });
        cameraService.getAllCameras.mockResolvedValue({ data: [{ id: 3, name: 'CCTV Gate' }] });
    });

    it('creates selected token payload with per-camera rules', async () => {
        const { result } = renderHook(() => usePlaybackTokenManagementPage());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.updateForm('scope_type', 'selected');
            result.current.toggleCameraRule(3, true);
            result.current.updateCameraRule(3, 'playback_window_hours', '24');
        });

        await act(async () => {
            await result.current.handleCreate(submitEvent());
        });

        expect(playbackTokenService.createToken).toHaveBeenCalledWith(expect.objectContaining({
            scope_type: 'selected',
            camera_rules: [{ camera_id: 3, enabled: true, playback_window_hours: 24, expires_at: null, note: '' }],
        }));
    });

    it('updates token scope and camera rules from edit form', async () => {
        playbackTokenService.listTokens.mockResolvedValue({
            data: [{
                id: 9,
                label: 'Client Lama',
                scope_type: 'all',
                camera_rules: [],
                allowed_camera_ids: [],
                max_active_sessions: null,
                session_limit_mode: 'unlimited',
                session_timeout_seconds: 60,
                share_template: 'Kode {{token}}',
            }],
        });
        const { result } = renderHook(() => usePlaybackTokenManagementPage());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.beginEditToken(result.current.tokens[0]);
            result.current.updateEditForm('scope_type', 'selected');
            result.current.toggleEditCameraRule(3, true);
            result.current.updateEditCameraRule(3, 'playback_window_hours', '12');
        });

        await act(async () => {
            await result.current.handleUpdateToken(9);
        });

        expect(playbackTokenService.updateToken).toHaveBeenCalledWith(9, expect.objectContaining({
            scope_type: 'selected',
            camera_rules: [{ camera_id: 3, enabled: true, playback_window_hours: 12, expires_at: null, note: '' }],
        }));
    });

    it('shares an existing token without telling operator the access code changed', async () => {
        playbackTokenService.shareToken.mockResolvedValue({
            success: true,
            share_text: 'Kode Akses: SANDI1234\nAkses: 1 kamera terpilih: CCTV Gate',
        });
        const { result } = renderHook(() => usePlaybackTokenManagementPage());

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleRepeatShare(9);
        });

        expect(playbackTokenService.shareToken).toHaveBeenCalledWith(9);
        expect(result.current.createdShare.shareText).toContain('SANDI1234');
        expect(result.current.createdShare.shareText).toContain('CCTV Gate');
        expect(notifySuccessMock).toHaveBeenCalledWith(
            'Teks share dibuat',
            'Kode akses yang sama siap dibagikan ulang.'
        );
    });

    it('extracts playback token share text from top-level and nested responses', () => {
        expect(extractPlaybackTokenShareText({ share_text: 'Top' })).toBe('Top');
        expect(extractPlaybackTokenShareText({ shareText: 'Camel' })).toBe('Camel');
        expect(extractPlaybackTokenShareText({ data: { share_text: 'Nested' } })).toBe('Nested');
        expect(extractPlaybackTokenShareText({ data: { shareText: 'Nested camel' } })).toBe('Nested camel');
        expect(extractPlaybackTokenShareText({})).toBe('');
    });

    it('stores share text from nested create response data', async () => {
        playbackTokenService.createToken.mockResolvedValue({
            data: {
                share_text: 'Halo token nested',
            },
        });
        const { result } = renderHook(() => usePlaybackTokenManagementPage());

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleCreate(submitEvent());
        });

        expect(result.current.createdShare.shareText).toBe('Halo token nested');
    });

    it('matches camera filter text by id, name, and area', () => {
        expect(cameraMatchesPlaybackTokenSearch({ id: 1168, name: 'CCTV ALANG ALANG' }, '1168')).toBe(true);
        expect(cameraMatchesPlaybackTokenSearch({ name: 'CCTV POS', area_name: 'Utara' }, 'utara')).toBe(true);
        expect(cameraMatchesPlaybackTokenSearch({ name: 'CCTV POS', areaName: 'Kantor' }, 'kantor')).toBe(true);
        expect(cameraMatchesPlaybackTokenSearch({ name: 'CCTV POS', area_name: 'Utara' }, 'selatan')).toBe(false);
    });

    it('filters create token camera picker by name and keeps selected cameras visible', async () => {
        const { cameraService } = await import('../../services/cameraService');
        cameraService.getAllCameras.mockResolvedValue({
            data: [
                { id: 1168, name: 'CCTV ALANG ALANG', area_name: 'Utara' },
                { id: 2001, name: 'CCTV LOBBY RAF NET', area_name: 'Kantor' },
                { id: 3001, name: 'CCTV JALAN DEPAN', area_name: 'Jalan' },
            ],
        });
        const { result } = renderHook(() => usePlaybackTokenManagementPage());

        await waitFor(() => expect(result.current.cameras).toHaveLength(3));

        act(() => {
            result.current.toggleCameraRule(2001, true);
            result.current.setCameraSearch('alang');
        });

        expect(result.current.visibleCreateCameras.map((camera) => camera.id)).toEqual([2001, 1168]);
    });
});
