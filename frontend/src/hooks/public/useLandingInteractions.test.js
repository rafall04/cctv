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

function renderInteractions(deviceTier = 'high') {
    const addToast = vi.fn();
    const setSearchParams = vi.fn();
    const addRecentCamera = vi.fn();

    const result = renderHook(() => useLandingInteractions({
        cameras: [1, 2, 3, 4].map(createCamera),
        layoutMode: 'simple',
        viewMode: 'grid',
        deviceTier,
        searchParams: new URLSearchParams(),
        setSearchParams,
        addToast,
        addRecentCamera,
    }));

    return {
        ...result,
        addToast,
    };
}

describe('useLandingInteractions multi-view limits', () => {
    it('caps high-end devices at three multi-view cameras', () => {
        const { result, addToast } = renderInteractions('high');

        act(() => {
            [1, 2, 3, 4].forEach((id) => {
                result.current.handleAddMulti(createCamera(id));
            });
        });

        expect(result.current.maxStreams).toBe(3);
        expect(result.current.multiCameras.map((camera) => camera.id)).toEqual([1, 2, 3]);
        expect(addToast).toHaveBeenCalledWith(
            'Maximum 3 cameras allowed in Multi-View mode (high-end device)',
            'warning'
        );
    });
});
