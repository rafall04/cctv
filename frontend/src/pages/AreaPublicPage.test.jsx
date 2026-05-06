/*
 * Purpose: Verify public area page data loading, stream resolution, empty state, and metadata behavior.
 * Caller: Frontend focused public area page test gate.
 * Deps: React Testing Library, MemoryRouter, vitest, AreaPublicPage, mocked public growth and stream APIs.
 * MainFuncs: AreaPublicPage render tests.
 * SideEffects: Mocks public growth API.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getAreaMock,
    getAreaCamerasMock,
    getTrendingCamerasMock,
    getStreamUrlsMock,
    videoPopupSpy,
} = vi.hoisted(() => ({
    getAreaMock: vi.fn(),
    getAreaCamerasMock: vi.fn(),
    getTrendingCamerasMock: vi.fn(),
    getStreamUrlsMock: vi.fn(),
    videoPopupSpy: vi.fn(),
}));

vi.mock('../services/publicGrowthService', () => ({
    default: {
        getArea: getAreaMock,
        getAreaCameras: getAreaCamerasMock,
        getTrendingCameras: getTrendingCamerasMock,
    },
}));

vi.mock('../services/streamService', () => ({
    streamService: {
        getStreamUrls: getStreamUrlsMock,
    },
}));

vi.mock('../components/MultiView/VideoPopup', () => ({
    default: (props) => {
        videoPopupSpy(props);
        return <div data-testid={props.modalTestId}>{props.camera?.streams?.hls || 'no-stream'}</div>;
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
        getStreamUrlsMock.mockReset();
        videoPopupSpy.mockReset();
        document.title = 'RAF NET';
    });

    it('renders area portal sections and cameras', async () => {
        getAreaMock.mockResolvedValue({
            success: true,
            data: { name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 2, online_count: 1, total_views: 92 },
        });
        getAreaCamerasMock.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 1,
                    name: 'CCTV A',
                    area_name: 'KAB SURABAYA',
                    total_views: 90,
                    live_viewers: 5,
                    created_at: '2026-05-06 08:00:00',
                },
                {
                    id: 2,
                    name: 'CCTV B',
                    area_name: 'KAB SURABAYA',
                    total_views: 2,
                    live_viewers: 0,
                    created_at: '2026-05-05 08:00:00',
                },
            ],
        });
        getTrendingCamerasMock.mockResolvedValue({
            success: true,
            data: [{ id: 1, name: 'CCTV A', area_name: 'KAB SURABAYA', total_views: 90, live_viewers: 5 }],
        });

        renderPage();

        await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /KAB SURABAYA/i })).toBeTruthy());
        expect(screen.getByRole('link', { name: /Kembali ke CCTV Publik/i }).getAttribute('href')).toBe('/');
        expect(screen.getByRole('heading', { level: 2, name: /Status Area/i })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: /Sedang Ramai di KAB SURABAYA/i })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: /Top CCTV KAB SURABAYA/i })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: /Kamera Baru KAB SURABAYA/i })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: /Semua CCTV Area/i })).toBeTruthy();
        expect(screen.getAllByText(/2 kamera/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/5 live/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/CCTV A/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/CCTV B/i).length).toBeGreaterThan(0);
        expect(document.title).toBe('CCTV Online KAB SURABAYA - RAF NET');
    });

    it('falls back to clipboard when native area sharing fails', async () => {
        const nativeShare = vi.fn().mockRejectedValue(new Error('Share unavailable'));
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(window.navigator, 'share', {
            configurable: true,
            value: nativeShare,
        });
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        getAreaMock.mockResolvedValue({
            success: true,
            data: { name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 1, online_count: 1, total_views: 9 },
        });
        getAreaCamerasMock.mockResolvedValue({ success: true, data: [] });
        getTrendingCamerasMock.mockResolvedValue({ success: true, data: [] });

        renderPage();

        await waitFor(() => expect(screen.getByRole('button', { name: /Share Area/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /Share Area/i }));

        await waitFor(() => {
            expect(nativeShare).toHaveBeenCalledTimes(1);
            expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/area/kab-surabaya'));
        });
        expect(screen.getByRole('status').textContent).toContain('disalin');
    });

    it('renders public not found state', async () => {
        getAreaMock.mockRejectedValue({ response: { status: 404 } });
        getAreaCamerasMock.mockResolvedValue({ success: true, data: [] });
        getTrendingCamerasMock.mockResolvedValue({ success: true, data: [] });

        renderPage('/area/hilang');

        await waitFor(() => expect(screen.getByText(/Area tidak ditemukan/i)).toBeTruthy());
    });

    it('resolves public area cameras through the standard stream payload before opening popup', async () => {
        getAreaMock.mockResolvedValue({
            success: true,
            data: { name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 1, online_count: 1, total_views: 9 },
        });
        getAreaCamerasMock.mockResolvedValue({
            success: true,
            data: [{ id: 8, name: 'CCTV Area Raw', area_name: 'KAB SURABAYA', total_views: 9 }],
        });
        getTrendingCamerasMock.mockResolvedValue({ success: true, data: [] });
        getStreamUrlsMock.mockResolvedValue({
            success: true,
            data: {
                camera: { id: 8, name: 'CCTV Area Raw', area_name: 'KAB SURABAYA', delivery_type: 'internal_hls' },
                streams: { hls: '/hls/camera-8/index.m3u8' },
                stream_source: 'internal',
                delivery_type: 'internal_hls',
            },
        });

        renderPage();

        await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /Semua CCTV Area/i })).toBeTruthy());
        const allCamerasSection = screen.getByRole('heading', { level: 2, name: /Semua CCTV Area/i }).closest('section');
        fireEvent.click(within(allCamerasSection).getByRole('button', { name: /CCTV Area Raw/i }));

        await waitFor(() => {
            expect(getStreamUrlsMock).toHaveBeenCalledWith(8);
            expect(screen.getByTestId('area-popup-modal').textContent).toContain('/hls/camera-8/index.m3u8');
        });
        expect(videoPopupSpy).toHaveBeenCalledWith(expect.objectContaining({
            camera: expect.objectContaining({
                id: 8,
                streams: { hls: '/hls/camera-8/index.m3u8' },
            }),
        }));
    });

    it('shows the selected camera immediately while stream resolution is still pending', async () => {
        let resolveStream;
        const streamPromise = new Promise((resolve) => {
            resolveStream = resolve;
        });

        getAreaMock.mockResolvedValue({
            success: true,
            data: { name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 1, online_count: 1, total_views: 9 },
        });
        getAreaCamerasMock.mockResolvedValue({
            success: true,
            data: [{ id: 9, name: 'CCTV Pending Stream', area_name: 'KAB SURABAYA', total_views: 9 }],
        });
        getTrendingCamerasMock.mockResolvedValue({ success: true, data: [] });
        getStreamUrlsMock.mockReturnValue(streamPromise);

        renderPage();

        await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /Semua CCTV Area/i })).toBeTruthy());
        const allCamerasSection = screen.getByRole('heading', { level: 2, name: /Semua CCTV Area/i }).closest('section');
        fireEvent.click(within(allCamerasSection).getByRole('button', { name: /CCTV Pending Stream/i }));

        expect(screen.getByTestId('area-popup-modal').textContent).toContain('no-stream');
        expect(videoPopupSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            camera: expect.objectContaining({
                id: 9,
                name: 'CCTV Pending Stream',
                _stream_resolution_pending: true,
            }),
        }));

        resolveStream({
            success: true,
            data: {
                camera: { id: 9, name: 'CCTV Pending Stream', area_name: 'KAB SURABAYA', delivery_type: 'internal_hls' },
                streams: { hls: '/hls/camera-9/index.m3u8' },
                stream_source: 'internal',
                delivery_type: 'internal_hls',
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('area-popup-modal').textContent).toContain('/hls/camera-9/index.m3u8');
        });
        expect(videoPopupSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            camera: expect.objectContaining({
                id: 9,
                _stream_resolution_pending: false,
            }),
        }));
    });
});
