/*
Purpose: Verify public landing interaction state, especially multi-view selection limits.
Caller: Vitest frontend hook suite.
Deps: React Testing Library renderHook, useLandingInteractions.
MainFuncs: useLandingInteractions tests.
SideEffects: None.
*/

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLandingInteractions } from './useLandingInteractions.js';

function createCamera(id) {
    return {
        id,
        name: `Camera ${id}`,
        delivery_type: 'internal_hls',
        streams: { hls: `/hls/${id}/index.m3u8` },
        is_online: 1,
        status: 'active',
    };
}

const stableCameras = [1, 2, 3, 4].map(createCamera);

function renderInteractions(deviceTier = 'high', overrides = {}) {
    const addToast = vi.fn();
    const setSearchParams = vi.fn();
    const addRecentCamera = vi.fn();

    const result = renderHook(() => useLandingInteractions({
        cameras: stableCameras,
        layoutMode: 'simple',
        viewMode: 'grid',
        deviceTier,
        searchParams: new URLSearchParams(),
        setSearchParams,
        addToast,
        addRecentCamera,
        resolveUrlCamera: overrides.resolveUrlCamera,
    }));

    return {
        ...result,
        addToast,
        setSearchParams,
    };
}

function renderInteractionsWithSearch(searchParams) {
    const setSearchParams = vi.fn();
    return renderHook(
        ({ params }) => useLandingInteractions({
            cameras: stableCameras,
            layoutMode: 'simple',
            viewMode: 'grid',
            deviceTier: 'high',
            searchParams: params,
            setSearchParams,
            addToast: vi.fn(),
            addRecentCamera: vi.fn(),
        }),
        { initialProps: { params: searchParams } }
    );
}

describe('useLandingInteractions multi-view limits', () => {
    it('caps high-end devices at three multi-view cameras', async () => {
        const { result, addToast } = renderInteractions('high');

        await act(async () => {
            for (const id of [1, 2, 3, 4]) {
                await result.current.handleAddMulti(createCamera(id));
            }
        });

        expect(result.current.maxStreams).toBe(3);
        expect(result.current.multiCameras.map((camera) => camera.id)).toEqual([1, 2, 3]);
        expect(addToast).toHaveBeenCalledWith(
            'Maximum 3 cameras allowed in Multi-View mode (high-end device)',
            'warning'
        );
    });

    it('resolves metadata-only cameras before adding them to multi-view', async () => {
        const resolveUrlCamera = vi.fn().mockResolvedValue({
            ...createCamera(7),
            streams: { hls: 'https://example.com/resolved.m3u8' },
        });
        const hook = renderInteractions('high', { resolveUrlCamera });

        await act(async () => {
            await hook.result.current.handleAddMulti({
                ...createCamera(7),
                streams: {},
            });
        });

        expect(resolveUrlCamera).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
        expect(hook.result.current.multiCameras).toEqual([
            expect.objectContaining({
                id: 7,
                streams: { hls: 'https://example.com/resolved.m3u8' },
            }),
        ]);
    });

    it('keeps a deterministic warning when multi-view stream resolution fails', async () => {
        const resolveUrlCamera = vi.fn().mockRejectedValue(new Error('network'));
        const hook = renderInteractions('high', { resolveUrlCamera });

        await act(async () => {
            await hook.result.current.handleAddMulti(createCamera(8));
        });

        expect(hook.result.current.multiCameras).toEqual([]);
        expect(hook.addToast).toHaveBeenCalledWith(
            '"Camera 8" gagal disiapkan untuk Multi-View',
            'warning'
        );
    });

    it('tidak menimpa popup pending dengan kamera mentah dari URL sync untuk id yang sama', () => {
        const hook = renderInteractionsWithSearch(new URLSearchParams());

        act(() => {
            hook.result.current.handleCameraClick({
                ...createCamera(2),
                streams: {},
                _stream_resolution_pending: true,
            });
        });

        expect(hook.result.current.popup?._stream_resolution_pending).toBe(true);

        hook.rerender({ params: new URLSearchParams('camera=2-camera-2') });

        expect(hook.result.current.popup?._stream_resolution_pending).toBe(true);
        expect(hook.result.current.popup?.streams).toEqual({});
    });

    it('bisa mengganti popup tanpa menambah history entry baru', () => {
        const { result, setSearchParams } = renderInteractions('high');

        act(() => {
            result.current.handleCameraClick(createCamera(2), { replaceHistory: true });
        });

        expect(setSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true });
    });

    it('tidak menghidupkan ulang popup lama ketika URL lama belum sinkron setelah switch related', () => {
        const hook = renderInteractionsWithSearch(new URLSearchParams('camera=1-camera-1'));

        act(() => {
            hook.result.current.handleCameraClick(createCamera(2), { replaceHistory: true });
        });

        expect(hook.result.current.popup?.id).toBe(2);

        hook.rerender({ params: new URLSearchParams('camera=1-camera-1') });

        expect(hook.result.current.popup?.id).toBe(2);
    });

    it('tidak membuka ulang popup ketika close menunggu URL menghapus camera param', () => {
        const hook = renderInteractionsWithSearch(new URLSearchParams('camera=1-camera-1'));

        act(() => {
            hook.result.current.handleCameraClick(createCamera(1));
        });

        expect(hook.result.current.popup?.id).toBe(1);

        act(() => {
            hook.result.current.handlePopupClose();
        });

        hook.rerender({ params: new URLSearchParams('camera=1-camera-1') });

        expect(hook.result.current.popup).toBeNull();
    });
});
