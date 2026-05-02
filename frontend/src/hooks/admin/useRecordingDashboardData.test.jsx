// @vitest-environment jsdom
/*
Purpose: Validate recording dashboard polling cadence and visibility-aware refresh behavior.
Caller: Vitest frontend suite before dashboard polling changes.
Deps: React Testing Library hook utilities and mocked recording dashboard services.
MainFuncs: useRecordingDashboardData.
SideEffects: Uses fake timers and mocked API calls only.
*/

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecordingDashboardData } from './useRecordingDashboardData.js';

const {
    getRecordingsOverview,
    getRestartLogs,
    getRecordingAssurance,
} = vi.hoisted(() => ({
    getRecordingsOverview: vi.fn(),
    getRestartLogs: vi.fn(),
    getRecordingAssurance: vi.fn(),
}));

vi.mock('../../services/recordingService', () => ({
    default: {
        getRecordingsOverview,
        getRestartLogs,
        getRecordingAssurance,
    },
}));

vi.mock('./useAdminReconnectRefresh', () => ({
    useAdminReconnectRefresh: vi.fn(),
}));

function mockSuccessfulFetches() {
    getRecordingsOverview.mockResolvedValue({
        success: true,
        data: {
            cameras: [],
        },
    });
    getRestartLogs.mockResolvedValue({
        success: true,
        data: [],
    });
    getRecordingAssurance.mockResolvedValue({
        success: true,
        data: {
            summary: {
                total_monitored: 0,
                healthy: 0,
                warning: 0,
                critical: 0,
                recording_down: 0,
                stale_segments: 0,
                missing_segments: 0,
                recent_gap_cameras: 0,
            },
            cameras: [],
        },
    });
}

function setVisibilityState(state) {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: state,
    });
}

async function flushAsyncWork() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

async function flushStableState() {
    await flushAsyncWork();
    await flushAsyncWork();
}

describe('useRecordingDashboardData', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        setVisibilityState('visible');
        mockSuccessfulFetches();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('does not trigger background polling while the document is hidden', async () => {
        renderHook(() => useRecordingDashboardData());

        await flushStableState();

        expect(getRecordingsOverview).toHaveBeenCalledTimes(1);

        setVisibilityState('hidden');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(30000);
        });

        expect(getRecordingsOverview).toHaveBeenCalledTimes(1);
        expect(getRestartLogs).toHaveBeenCalledTimes(1);
        expect(getRecordingAssurance).toHaveBeenCalledTimes(1);
    });

    it('backs off polling interval after a background refresh failure', async () => {
        getRecordingsOverview
            .mockResolvedValueOnce({
                success: true,
                data: { cameras: [{ id: 1, recording_status: 'recording' }] },
            })
            .mockRejectedValueOnce(new Error('background failed'))
            .mockResolvedValue({
                success: true,
                data: { cameras: [{ id: 1, recording_status: 'recording' }] },
            });

        getRestartLogs
            .mockResolvedValueOnce({ success: true, data: [] })
            .mockRejectedValueOnce(new Error('background failed'))
            .mockResolvedValue({ success: true, data: [] });

        getRecordingAssurance
            .mockResolvedValueOnce({
                success: true,
                data: {
                    summary: {
                        total_monitored: 1,
                        healthy: 1,
                        warning: 0,
                        critical: 0,
                        recording_down: 0,
                        stale_segments: 0,
                        missing_segments: 0,
                        recent_gap_cameras: 0,
                    },
                    cameras: [],
                },
            })
            .mockRejectedValueOnce(new Error('background failed'))
            .mockResolvedValue({
                success: true,
                data: {
                    summary: {
                        total_monitored: 1,
                        healthy: 1,
                        warning: 0,
                        critical: 0,
                        recording_down: 0,
                        stale_segments: 0,
                        missing_segments: 0,
                        recent_gap_cameras: 0,
                    },
                    cameras: [],
                },
            });

        const { result } = renderHook(() => useRecordingDashboardData());

        await flushStableState();

        const initialCallCount = getRecordingsOverview.mock.calls.length;
        expect(initialCallCount).toBeGreaterThan(0);

        await act(async () => {
            await result.current.fetchData({ mode: 'background' });
        });

        const afterFailureCallCount = getRecordingsOverview.mock.calls.length;
        expect(afterFailureCallCount).toBe(initialCallCount + 1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(10000);
        });

        expect(getRecordingsOverview.mock.calls.length).toBe(afterFailureCallCount);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(20000);
        });

        await flushStableState();

        expect(getRecordingsOverview.mock.calls.length).toBe(afterFailureCallCount + 1);
    });
});
