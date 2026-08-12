/*
 * PromoBannerManagement.test.jsx — the admin list page.
 *
 * Plain DOM assertions on purpose: this project does not load @testing-library/jest-dom.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PromoBannerManagement from './PromoBannerManagement';

const h = vi.hoisted(() => ({
    getAllPromoBanners: vi.fn(),
    createPromoBanner: vi.fn(),
    updatePromoBanner: vi.fn(),
    deletePromoBanner: vi.fn(),
    getAllAreas: vi.fn(),
    getAllCameras: vi.fn(),
    showNotification: vi.fn(),
}));

vi.mock('../services/promoBannerService', () => ({
    getAllPromoBanners: h.getAllPromoBanners,
    createPromoBanner: h.createPromoBanner,
    updatePromoBanner: h.updatePromoBanner,
    deletePromoBanner: h.deletePromoBanner,
}));
vi.mock('../services/areaService', () => ({ areaService: { getAllAreas: h.getAllAreas } }));
vi.mock('../services/cameraService', () => ({ cameraService: { getAllCameras: h.getAllCameras } }));
vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ showNotification: h.showNotification }),
}));

const PROMO = {
    id: 7,
    title: 'Pemasangan Gratis',
    placements: ['popup'],
    target_mode: 'all',
    active: 1,
    image_base: 'promo-0123456789ab',
    area_ids: [],
    camera_ids: [],
    total_impressions: 200,
    total_clicks: 10,
    is_live: 1,
    schedule_state: 'live',
};

beforeEach(() => {
    vi.clearAllMocks();
    h.getAllPromoBanners.mockResolvedValue({ success: true, data: [PROMO] });
    h.getAllAreas.mockResolvedValue({ success: true, data: [{ id: 2, name: 'DANDER' }] });
    h.getAllCameras.mockResolvedValue({ success: true, data: [{ id: 11, name: 'CCTV DANDER' }] });
});

describe('loading is resilient', () => {
    it('still lists promos when the camera request THROWS', async () => {
        /*
         * cameraService.getAllCameras rejects instead of returning { success: false }.
         * A bare Promise.all would reject, so `setLoading(false)` never ran and the
         * whole page — including the promo list, which needs no cameras — stayed
         * stuck on "Memuat…".
         */
        h.getAllCameras.mockRejectedValue(new Error('boom'));

        render(<PromoBannerManagement />);

        expect(await screen.findByText('Pemasangan Gratis')).not.toBeNull();
        await waitFor(() => expect(screen.queryByText('Memuat…')).toBeNull());
    });

    it('still lists promos when the area request throws', async () => {
        h.getAllAreas.mockRejectedValue(new Error('boom'));

        render(<PromoBannerManagement />);

        expect(await screen.findByText('Pemasangan Gratis')).not.toBeNull();
    });

    it('reports a failure to load the promos themselves', async () => {
        h.getAllPromoBanners.mockResolvedValue({ success: false, message: 'gagal' });

        render(<PromoBannerManagement />);

        await waitFor(() => expect(h.showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', title: expect.stringMatching(/Gagal memuat/) })
        ));
    });

    it('shows an empty state when there are no promos', async () => {
        h.getAllPromoBanners.mockResolvedValue({ success: true, data: [] });

        render(<PromoBannerManagement />);

        expect(await screen.findByText('Belum ada promo.')).not.toBeNull();
    });
});

describe('status chip follows the SERVER schedule state', () => {
    it('shows Tayang for a live banner', async () => {
        render(<PromoBannerManagement />);
        expect(await screen.findByText('Tayang')).not.toBeNull();
    });

    it.each([
        ['expired', 'Kedaluwarsa'],
        ['not_started', 'Belum mulai'],
        ['inactive', 'Nonaktif'],
        ['no_image', 'Tanpa gambar'],
    ])('shows %s as "%s" without recomputing the date in the browser', async (state, label) => {
        // Recomputing "today" from the browser clock (UTC) disagreed with the
        // backend's local-date window for the first 7 hours of every WIB day.
        h.getAllPromoBanners.mockResolvedValue({
            success: true,
            data: [{ ...PROMO, is_live: 0, schedule_state: state }],
        });

        render(<PromoBannerManagement />);

        expect(await screen.findByText(label)).not.toBeNull();
        expect(screen.queryByText('Tayang')).toBeNull();
    });
});

describe('stats readout', () => {
    it('shows impressions, clicks, and the rate between them', async () => {
        render(<PromoBannerManagement />);
        expect(await screen.findByText(/200 tayang · 10 klik/)).not.toBeNull();
        expect(screen.getByText(/5\.0%/)).not.toBeNull();
    });

    it('does not divide by zero before the first impression', async () => {
        h.getAllPromoBanners.mockResolvedValue({
            success: true,
            data: [{ ...PROMO, total_impressions: 0, total_clicks: 0 }],
        });

        render(<PromoBannerManagement />);

        expect(await screen.findByText(/0 tayang · 0 klik/)).not.toBeNull();
        expect(screen.queryByText(/NaN/)).toBeNull();
    });
});
