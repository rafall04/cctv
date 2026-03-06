// @vitest-environment jsdom

import { render, screen, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
        getAllActiveStreams.mockReset();
        getPublicAreas.mockReset();
        getPublicAreas.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Area 1' }] });
    });

    it('mempertahankan data lama saat refresh resume gagal', async () => {
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
});
