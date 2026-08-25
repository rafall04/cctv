// @vitest-environment jsdom

/*
 * Purpose: Validate public camera context refresh behavior across resume and network recovery flows.
 * Caller: Frontend Vitest suite for public camera data regressions.
 * Deps: React Testing Library, CameraContext, mocked camera/area services, mocked device tier.
 * MainFuncs: CameraProvider and useCameras integration tests.
 * SideEffects: Renders jsdom providers and dispatches browser focus/online events.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraProvider, useCameras } from './CameraContext';

const { getActiveCameras } = vi.hoisted(() => ({
    getActiveCameras: vi.fn(),
}));

const { getPublicAreas } = vi.hoisted(() => ({
    getPublicAreas: vi.fn(),
}));

vi.mock('../services/cameraService', () => ({
    cameraService: {
        getActiveCameras,
    },
}));

vi.mock('../services/areaService', () => ({
    areaService: {
        getPublicAreas,
    },
}));

vi.mock('../utils/deviceDetector', () => ({
    detectDeviceTier: () => 'medium',
    isMobileDevice: () => false,
    getConnectionType: () => 'unknown',
}));

function CameraConsumer() {
    const {
        cameras,
        loading,
        dataUnavailable,
        initialLoadError,
        backgroundRefreshError,
    } = useCameras();

    return (
        <div>
            <div data-testid="camera-count">{cameras.length}</div>
            <div data-testid="loading">{loading ? 'yes' : 'no'}</div>
            <div data-testid="data-unavailable">{dataUnavailable ? 'yes' : 'no'}</div>
            <div data-testid="initial-error">{initialLoadError ? 'yes' : 'no'}</div>
            <div data-testid="background-error">{backgroundRefreshError ? 'yes' : 'no'}</div>
        </div>
    );
}

describe('CameraContext', () => {
    beforeEach(() => {
        vi.useRealTimers();
        getActiveCameras.mockReset();
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

    /*
     * The public surfaces need a THIRD state. Before this flag they only had loading/not-loading,
     * so a failed initial load retired the "…" placeholder and let every counter print a hard 0 —
     * a total outage rendered as a factual report of a network with zero cameras.
     */
    it('menandai data belum bisa diambil saat pemuatan awal gagal total', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        getActiveCameras.mockRejectedValue(new Error('network down'));
        getPublicAreas.mockRejectedValue(new Error('network down'));

        render(
            <CameraProvider autoRefresh={false}>
                <CameraConsumer />
            </CameraProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('loading').textContent).toBe('no');
            expect(screen.getByTestId('initial-error').textContent).toBe('yes');
        }, { timeout: 4000 });

        expect(screen.getByTestId('camera-count').textContent).toBe('0');
        expect(screen.getByTestId('data-unavailable').textContent).toBe('yes');
        errorSpy.mockRestore();
    });

    it('mempertahankan data lama saat refresh resume gagal', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        getActiveCameras
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

        expect(getActiveCameras).toHaveBeenLastCalledWith(
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
        getActiveCameras
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
        getActiveCameras.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Cam 1' }] });

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
        expect(getActiveCameras).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
        });

        await act(async () => {
            vi.advanceTimersByTime(60000);
            await Promise.resolve();
        });

        expect(getActiveCameras).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });

        await act(async () => {
            vi.advanceTimersByTime(60000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(getActiveCameras).toHaveBeenCalledTimes(2);
    });
});
