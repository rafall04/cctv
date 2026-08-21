/*
 * Purpose: Verify public area page data loading, stream resolution, empty state, and metadata behavior.
 * Caller: Frontend focused public area page test gate.
 * Deps: React Testing Library, MemoryRouter, vitest, AreaPublicPage, mocked public growth and stream APIs.
 * MainFuncs: AreaPublicPage render tests.
 * SideEffects: Mocks public growth API.
 *
 * ── THE HEADER ROW (2026-08-21) ───────────────────────────────────────────────────────────────
 * "Kembali ke CCTV Publik" and "Bagikan Area" used to stack as two full-width rows ABOVE the <h1>,
 * the second of them a filled primary block — so the first screen of an area page on a phone was
 * two rows of chrome shouting above the name of the thing they were about. They now share ONE row:
 * back left, share right.
 * The last describe block below pins that, and pins the two things the fix is not allowed to cost:
 *   · nothing hides. The labels SHORTEN below `sm` through plain responsive utilities and the FULL
 *     label stays in aria-label AND title — no scroll, no menu, no disclosure, and no JS
 *     window-width state (which flickers on first paint and complicates hydration).
 *   · both stay thumb-sized and keyboard-visible: 44px high, with a focus ring.
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

/** The smallest payload that gets the page past `loading` and onto its real header. */
function mockArea() {
    getAreaMock.mockResolvedValue({
        success: true,
        data: { name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 1, online_count: 1, total_views: 9 },
    });
    getAreaCamerasMock.mockResolvedValue({ success: true, data: [] });
    getTrendingCamerasMock.mockResolvedValue({ success: true, data: [] });
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
        expect(screen.getByRole('heading', { level: 2, name: /Paling Sering Dibuka di KAB SURABAYA/i })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: /Kamera Baru KAB SURABAYA/i })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: /Semua CCTV Area/i })).toBeTruthy();
        expect(screen.getAllByText(/2 kamera/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/5 live/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/CCTV A/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/CCTV B/i).length).toBeGreaterThan(0);
        expect(document.title).toBe('CCTV Online KAB SURABAYA - RAF');
    });

    it('merender daftar semua CCTV area secara bertahap untuk area besar', async () => {
        const areaCameras = Array.from({ length: 26 }, (_, index) => ({
            id: index + 100,
            name: `CCTV Area ${index + 1}`,
            area_name: 'KAB SURABAYA',
            total_views: index,
            live_viewers: 0,
        }));

        getAreaMock.mockResolvedValue({
            success: true,
            data: { name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 26, online_count: 20, total_views: 200 },
        });
        getAreaCamerasMock.mockResolvedValue({ success: true, data: areaCameras });
        getTrendingCamerasMock.mockResolvedValue({ success: true, data: [] });

        renderPage();

        await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /Semua CCTV Area/i })).toBeTruthy());

        const allCamerasSection = screen.getByRole('heading', { level: 2, name: /Semua CCTV Area/i }).closest('section');
        expect(within(allCamerasSection).getByText('CCTV Area 12')).toBeTruthy();
        expect(within(allCamerasSection).queryByText('CCTV Area 13')).toBeNull();
        expect(within(allCamerasSection).getByText(/Menampilkan 12 dari 26 kamera/i)).toBeTruthy();

        fireEvent.click(within(allCamerasSection).getByRole('button', { name: /Tampilkan 12 kamera lagi/i }));

        expect(within(allCamerasSection).getByText('CCTV Area 24')).toBeTruthy();
        expect(within(allCamerasSection).queryByText('CCTV Area 25')).toBeNull();
    });

    it('memprioritaskan thumbnail pertama di daftar semua CCTV area', async () => {
        getAreaMock.mockResolvedValue({
            success: true,
            data: { name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 2, online_count: 2, total_views: 20 },
        });
        getAreaCamerasMock.mockResolvedValue({
            success: true,
            data: [
                { id: 31, name: 'CCTV Priority A', area_name: 'KAB SURABAYA', thumbnail_path: '/api/thumbnails/31.jpg' },
                { id: 32, name: 'CCTV Priority B', area_name: 'KAB SURABAYA', thumbnail_path: '/api/thumbnails/32.jpg' },
            ],
        });
        getTrendingCamerasMock.mockResolvedValue({ success: true, data: [] });

        renderPage();

        await waitFor(() => expect(screen.getByAltText('CCTV Priority A preview')).toBeTruthy());
        expect(screen.getByAltText('CCTV Priority A preview').getAttribute('loading')).toBe('eager');
        expect(screen.getByAltText('CCTV Priority B preview').getAttribute('loading')).toBe('eager');
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

        await waitFor(() => expect(screen.getByRole('button', { name: /Bagikan Area/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /Bagikan Area/i }));

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

    it('keeps the back and share controls on ONE row, both named in full', async () => {
        mockArea();

        renderPage();

        const back = await screen.findByRole('link', { name: 'Kembali ke CCTV Publik' });
        const share = screen.getByRole('button', { name: 'Bagikan Area' });

        // ONE row, not two stacked blocks: the shared parent is what makes that a fact rather than
        // a screenshot, and `flex-col` is exactly the thing that used to push the <h1> below the fold.
        const row = back.parentElement;
        expect(row.contains(share), 'back and share must share one row').toBe(true);
        expect(row.getAttribute('class')).toMatch(/\bflex\b/);
        expect(row.getAttribute('class'), 'stacking them is the regression').not.toMatch(/\bflex-col\b/);
        expect(row.getAttribute('class'), 'back left, share right').toMatch(/justify-between/);

        // Back first in the DOM, share second — reading order matches the visual one.
        expect([...row.children].indexOf(back)).toBe(0);
        expect([...row.children].indexOf(share)).toBe(1);

        // The row is above the title, and the title is still on the page.
        expect(screen.getByRole('heading', { level: 1, name: /KAB SURABAYA/i })).toBeTruthy();
        expect(back.getAttribute('href')).toBe('/');
    });

    /*
     * The labels shorten below `sm`; they do not disappear. The word that survives at every width is
     * the one that carries the meaning ("Kembali", "Bagikan"), and the rest is a `hidden sm:inline`
     * span — a CSS decision, so there is no window-width state to flicker on first paint.
     */
    it('shortens the header labels below sm without hiding them, and keeps the full name', async () => {
        mockArea();

        renderPage();

        const back = await screen.findByRole('link', { name: 'Kembali ke CCTV Publik' });
        const share = screen.getByRole('button', { name: 'Bagikan Area' });

        expect(back.textContent).toBe('Kembali ke CCTV Publik');
        expect(share.textContent).toBe('Bagikan Area');

        // The half that hides is the qualifier, never the verb.
        const backTail = [...back.querySelectorAll('span')].find((s) => s.textContent === ' ke CCTV Publik');
        const shareTail = [...share.querySelectorAll('span')].find((s) => s.textContent === ' Area');
        expect(backTail.getAttribute('class')).toBe('hidden sm:inline');
        expect(shareTail.getAttribute('class')).toBe('hidden sm:inline');

        // A long-press or hover still says the whole sentence.
        expect(back.getAttribute('title')).toBe('Kembali ke CCTV Publik');
        expect(share.getAttribute('title')).toBe('Bagikan Area');
    });

    /*
     * These are the first things a thumb meets on a public page, and the share used to be a filled
     * primary block shouting above the title. It keeps the brand colour — it is still THE action
     * here — through the pre-declared tint. `bg-primary/10` compiles to NOTHING against
     * `--primary-color`, which holds a full colour rather than the channel triplet Tailwind needs.
     */
    it('keeps both header controls thumb-sized, focusable and off the fault colour', async () => {
        mockArea();

        renderPage();

        const back = await screen.findByRole('link', { name: 'Kembali ke CCTV Publik' });
        const share = screen.getByRole('button', { name: 'Bagikan Area' });

        for (const control of [back, share]) {
            const cls = control.getAttribute('class');
            expect(cls).toMatch(/\bmin-h-\[44px\]/);
            expect(cls).toMatch(/focus-visible:outline-2/);
            expect(cls, 'nothing here is a fault').not.toMatch(/status-fault/);
            expect(cls).not.toMatch(/(^|[\s:-])gray-\d/);
            expect(cls).not.toMatch(/(^|[\s:])(dark|light)-\d/);
        }

        const shareCls = share.getAttribute('class');
        expect(shareCls, 'the tint, not the fill — it must not out-shout the title').toContain('bg-primary-100');
        expect(shareCls, 'bg-primary/10 compiles to nothing here').not.toMatch(/bg-primary\/\d/);
    });

    /* The result of the share is a whole sentence; beside a button it is how a row gets wider than a
       320px screen. It belongs below the row. */
    it('prints the share result below the row, never inside it', async () => {
        const nativeShare = vi.fn().mockRejectedValue(new Error('Share unavailable'));
        Object.defineProperty(window.navigator, 'share', { configurable: true, value: nativeShare });
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
        mockArea();

        renderPage();

        const back = await screen.findByRole('link', { name: 'Kembali ke CCTV Publik' });
        const row = back.parentElement;
        fireEvent.click(screen.getByRole('button', { name: 'Bagikan Area' }));

        const status = await screen.findByRole('status');
        expect(row.contains(status)).toBe(false);
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
