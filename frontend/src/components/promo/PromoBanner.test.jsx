/*
 * PromoBanner.test.jsx — the public poster: it must stay invisible when nothing is
 * configured, ship the small rendition to phones, and only count a click when the
 * visitor actually leaves for the CTA.
 *
 * Plain DOM assertions on purpose: this project does not load @testing-library/jest-dom.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PromoBanner from './PromoBanner';

const { getPublicPromoBanner, trackPromoBannerClick } = vi.hoisted(() => ({
    getPublicPromoBanner: vi.fn(),
    trackPromoBannerClick: vi.fn(),
}));

vi.mock('../../services/promoBannerService', () => ({
    getPublicPromoBanner,
    trackPromoBannerClick,
}));

const PROMO = {
    id: 7,
    title: 'Pemasangan CCTV Gratis',
    alt_text: 'Promo pemasangan CCTV gratis untuk area minimal 6 pelanggan',
    image_base: 'promo-0123456789ab',
    image_width: 1200,
    image_height: 894,
    cta_label: 'Tanya Pemasangan',
    cta_url: 'https://wa.me/6281234567890?text=Halo',
};

beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no IntersectionObserver; the component falls back to fetching
    // immediately, which is the behaviour we want under test.
    delete globalThis.IntersectionObserver;
});

describe('PromoBanner', () => {
    it('renders nothing when no promo is configured', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: null });

        const { container } = render(<PromoBanner placement="popup" cameraId={11} />);

        await waitFor(() => expect(getPublicPromoBanner).toHaveBeenCalled());
        expect(container.querySelector('img')).toBeNull();
        expect(screen.queryByText('Promo')).toBeNull();
    });

    it('stays silent when the request fails — a public page must not show an error for this', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: false, message: 'boom' });

        render(<PromoBanner placement="popup" cameraId={11} />);

        await waitFor(() => expect(getPublicPromoBanner).toHaveBeenCalled());
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByText(/boom/)).toBeNull();
    });

    it.each([
        ['an empty array', []],
        ['an empty object', {}],
        ['a promo with no image yet', { id: 7, title: 'Draft', image_base: null }],
    ])('renders nothing for %s rather than a broken image', async (_label, data) => {
        // A truthy-but-unusable payload is what a stubbed or proxied endpoint returns;
        // accepting it would emit <img src=".../undefined-1200.webp">.
        getPublicPromoBanner.mockResolvedValue({ success: true, data });

        const { container } = render(<PromoBanner placement="popup" cameraId={11} />);

        await waitFor(() => expect(getPublicPromoBanner).toHaveBeenCalled());
        expect(container.querySelector('img')).toBeNull();
    });

    it('passes the placement and camera through to the resolver', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: PROMO });

        render(<PromoBanner placement="playback" cameraId={42} />);

        await waitFor(() => expect(getPublicPromoBanner).toHaveBeenCalledWith({
            placement: 'playback',
            cameraId: 42,
            areaId: undefined,
        }));
    });

    it('offers both WebP renditions so phones fetch the small one', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: PROMO });

        render(<PromoBanner placement="popup" cameraId={11} />);

        const image = await screen.findByAltText(PROMO.alt_text);
        expect(image.getAttribute('srcset')).toBe(
            '/api/promo-media/promo-0123456789ab-640.webp 640w, /api/promo-media/promo-0123456789ab-1200.webp 1200w'
        );
        expect(image.getAttribute('loading')).toBe('lazy');
        // Intrinsic size reserves the box up front so the poster cannot shift the
        // content below it as it decodes.
        expect(image.getAttribute('width')).toBe('1200');
        expect(image.getAttribute('height')).toBe('894');
    });

    it('labels the poster as a promo and keeps the alt text', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: PROMO });

        render(<PromoBanner placement="popup" cameraId={11} />);

        expect(await screen.findByText('Promo')).not.toBeNull();
        expect(screen.getByAltText(PROMO.alt_text)).not.toBeNull();
    });

    it('opens a zoomable dialog when the poster is tapped', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: PROMO });
        render(<PromoBanner placement="popup" cameraId={11} />);

        fireEvent.click(await screen.findByRole('button', { name: /Lihat promo lebih besar/i }));

        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-label')).toBe(PROMO.title);
        expect(screen.getByRole('button', { name: 'Tutup promo' })).not.toBeNull();
    });

    it('closes the dialog again', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: PROMO });
        render(<PromoBanner placement="popup" cameraId={11} />);
        fireEvent.click(await screen.findByRole('button', { name: /Lihat promo lebih besar/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Tutup promo' }));

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('counts a click only when the visitor follows the CTA', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: PROMO });
        render(<PromoBanner placement="popup" cameraId={11} />);

        // Merely enlarging the poster is engagement, not a conversion.
        fireEvent.click(await screen.findByRole('button', { name: /Lihat promo lebih besar/i }));
        expect(trackPromoBannerClick).not.toHaveBeenCalled();

        fireEvent.click(screen.getAllByRole('link', { name: /Tanya Pemasangan/i })[0]);
        expect(trackPromoBannerClick).toHaveBeenCalledWith(7);
    });

    it('opens the CTA in a new tab without leaking the referrer window', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: PROMO });

        render(<PromoBanner placement="popup" cameraId={11} />);

        const link = await screen.findByRole('link', { name: /Tanya Pemasangan/i });
        expect(link.getAttribute('href')).toBe(PROMO.cta_url);
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
    });

    it('renders the poster without a CTA when no destination is configured', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: { ...PROMO, cta_url: null } });

        render(<PromoBanner placement="popup" cameraId={11} />);

        expect(await screen.findByAltText(PROMO.alt_text)).not.toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('refetches and drops the old poster when the camera changes', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: PROMO });

        const { rerender } = render(<PromoBanner placement="popup" cameraId={11} />);
        await screen.findByAltText(PROMO.alt_text);

        getPublicPromoBanner.mockResolvedValue({ success: true, data: null });
        rerender(<PromoBanner placement="popup" cameraId={12} />);

        await waitFor(() => expect(screen.queryByAltText(PROMO.alt_text)).toBeNull());
        expect(getPublicPromoBanner).toHaveBeenLastCalledWith({
            placement: 'popup',
            cameraId: 12,
            areaId: undefined,
        });
    });
});
