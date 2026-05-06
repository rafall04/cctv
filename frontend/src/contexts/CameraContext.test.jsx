// @vitest-environment jsdom

/*
 * Purpose: Validate public camera context refresh behavior across resume and network recovery flows.
 * Caller: Frontend Vitest suite for public camera data regressions.
 * Deps: React Testing Library, CameraContext, mocked stream/area services, mocked device tier.
 * MainFuncs: CameraProvider and useCameras integration tests.
 * SideEffects: Renders jsdom providers and dispatches browser focus/online events.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraProvider, useCameras } from './CameraContext';

const { getAllActiveStreams } = vi.hoisted(() => ({
    getAllActiveStreams: vi.fn(),
}));

const { getPublicAreas } = vi.hoisted(() => ({
    getPublicAreas: vi.fn(),
}));

vi.mock('../services/streamService', () => ({
    streamService: {
        getAllActiveStreams,
    },
}));

vi.mock('../services/areaService', () => ({
    areaService: {
        getPublicAreas,
    },
}));

vi.mock('../utils/deviceDetector', () => ({
    detectDeviceTier: () => 'mid',
}));

function CameraConsumer() {
    const {
        cameras,
        initialLoadError,
        backgroundRefreshError,
    } = useCameras();

    return (
        <div>
            <div data-testid="camera-count">{cameras.length}</div>
            <div data-testid="initial-error">{initialLoadError ? 'yes' : 'no'}</div>
            <div data-testid="background-error">{backgroundRefreshError ? 'yes' : 'no'}</div>
        </div>
    );
}

describe('CameraContext', () => {
    beforeEach(() => {
        vi.useRealTimers();
        getAllActiveStreams.mockReset();
        getPublicAreas.mockReset();
        getPublicAreas.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Area 1' }] });
    });

    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });
    });

    it('mempertahankan data lama saat refresh resume gagal', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        getAllActiveStreams
            .mockResolvedValueOnce({ success: true, data: [{ id: 1, name: 'Cam 1' }] })
            .mockRejectedValue(new Error('network down'));

        render(
            <CameraProvider>
                <CameraConsumer />
            </CameraProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('camera-count').textContent).toBe('1');
        });

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('camera-count').textContent).toBe('1');
            expect(screen.getByTestId('background-error').textContent).toBe('yes');
            expect(screen.getByTestId('initial-error').textContent).toBe('no');
        }, { timeout: 4000 });

        expect(getAllActiveStreams).toHaveBeenLastCalledWith(
            'background',
            expect.objectContaining({ skipGlobalErrorNotification: true })
        );
        expect(getPublicAreas).toHaveBeenLastCalledWith(
            'background',
            expect.objectContaining({ skipGlobalErrorNotification: true })
        );
        expect(errorSpy).toHaveBeenCalledWith(
            'Failed to fetch camera and area data:',
            expect.any(Error)
        );
        errorSpy.mockRestore();
    });

    it('merefresh data saat browser kembali online', async () => {
        getAllActiveStreams
            .mockResolvedValueOnce({ success: true, data: [{ id: 1, name: 'Cam 1' }] })
            .mockResolvedValue({ success: true, data: [{ id: 1, name: 'Cam 1' }, { id: 2, name: 'Cam 2' }] });

        render(
            <CameraProvider>
                <CameraConsumer />
            </CameraProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('camera-count').textContent).toBe('1');
        });

        await act(async () => {
            window.dispatchEvent(new Event('online'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('camera-count').textContent).toBe('2');
            expect(screen.getByTestId('background-error').textContent).toBe('no');
        });
    });

    it('tidak menjalankan background refresh periodik saat tab publik sedang hidden', async () => {
        vi.useFakeTimers();
        getAllActiveStreams.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Cam 1' }] });

        render(
            <CameraProvider>
                <CameraConsumer />
            </CameraProvider>
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.getByTestId('camera-count').textContent).toBe('1');
        expect(getAllActiveStreams).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
        });

        await act(async () => {
            vi.advanceTimersByTime(30000);
            await Promise.resolve();
        });

        expect(getAllActiveStreams).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });

        await act(async () => {
            vi.advanceTimersByTime(30000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(getAllActiveStreams).toHaveBeenCalledTimes(2);
    });
});
