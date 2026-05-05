/*
 * Purpose: Verify public area page data loading, empty state, and metadata behavior.
 * Caller: Frontend focused public area page test gate.
 * Deps: React Testing Library, MemoryRouter, vitest, AreaPublicPage.
 * MainFuncs: AreaPublicPage render tests.
 * SideEffects: Mocks public growth API.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getAreaMock,
    getAreaCamerasMock,
    getTrendingCamerasMock,
} = vi.hoisted(() => ({
    getAreaMock: vi.fn(),
    getAreaCamerasMock: vi.fn(),
    getTrendingCamerasMock: vi.fn(),
}));

vi.mock('../services/publicGrowthService', () => ({
    default: {
        getArea: getAreaMock,
        getAreaCameras: getAreaCamerasMock,
        getTrendingCameras: getTrendingCamerasMock,
    },
}));

import AreaPublicPage from './AreaPublicPage';

function renderPage(path = '/area/kab-surabaya') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/area/:areaSlug" element={<AreaPublicPage />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('AreaPublicPage', () => {
    beforeEach(() => {
        getAreaMock.mockReset();
        getAreaCamerasMock.mockReset();
        getTrendingCamerasMock.mockReset();
        document.title = 'RAF NET';
    });

    it('renders area data and cameras', async () => {
        getAreaMock.mockResolvedValue({
            success: true,
            data: { name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 1, online_count: 1, total_views: 9 },
        });
        getAreaCamerasMock.mockResolvedValue({
            success: true,
            data: [{ id: 1, name: 'CCTV A', area_name: 'KAB SURABAYA', total_views: 9 }],
        });
        getTrendingCamerasMock.mockResolvedValue({
            success: true,
            data: [{ id: 1, name: 'CCTV A', area_name: 'KAB SURABAYA', total_views: 9 }],
        });

        renderPage();

        await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /KAB SURABAYA/i })).toBeTruthy());
        expect(screen.getAllByText(/1 kamera/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/CCTV A/i).length).toBeGreaterThan(0);
        expect(document.title).toBe('CCTV Online KAB SURABAYA - RAF NET');
    });

    it('renders public not found state', async () => {
        getAreaMock.mockRejectedValue({ response: { status: 404 } });
        getAreaCamerasMock.mockResolvedValue({ success: true, data: [] });
        getTrendingCamerasMock.mockResolvedValue({ success: true, data: [] });

        renderPage('/area/hilang');

        await waitFor(() => expect(screen.getByText(/Area tidak ditemukan/i)).toBeTruthy());
    });
});
