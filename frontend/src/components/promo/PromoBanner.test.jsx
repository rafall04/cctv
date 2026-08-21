/*
 * PromoBanner.test.jsx — the public poster: it must stay invisible when nothing is
 * configured, ship the small rendition to phones, and only count a click when the
 * visitor actually leaves for the CTA.
 *
 * ── WHAT THE DENSITY PASS (2026-08-21) MAY AND MAY NOT DO TO THIS BLOCK ──────────
 * The poster is the one thing on this crowded surface that was NOT allowed to get
 * denser: a promo you have to guess at is not a promo. So the tightening was limited
 * to the chrome AROUND it, and the last describe block below is what holds that line:
 *   · the poster still renders at full width, un-cropped and un-clamped — no
 *     line-clamp, no max-h, no object-cover on the inline rendition;
 *   · the "Promo" label may become lighter, but never smaller than text-xs and never
 *     below text-content-subtle, because that label IS the honesty disclosure that
 *     says this poster is house advertising rather than editorial content;
 *   · an empty banner leaves NO chrome behind — the className the host surface hands
 *     in is worn only once a promo actually landed, otherwise every camera without a
 *     promo gets a bare bordered box under its video.
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

/**
 * Every class attribute in the tree, joined.
 *
 * Scoped to `class` on purpose: `sizes` legitimately contains the string "100vw" (it
 * describes how wide the poster will be laid out, which is not a width the element
 * imposes), so matching /100vw/ against innerHTML would fail on correct markup.
 */
const classNames = (container) => Array.from(container.querySelectorAll('*'))
    .map((el) => el.getAttribute('class') || '')
    .join(' ');

const aPromo = (patch) => getPublicPromoBanner.mockResolvedValue({ success: true, data: { ...PROMO, ...patch } });

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

describe('PromoBanner — the density pass tightened the chrome, not the poster', () => {
    it('keeps the poster at full width, uncropped and unclamped', async () => {
        aPromo();

        render(<PromoBanner placement="popup" cameraId={11} />);

        const cls = (await screen.findByAltText(PROMO.alt_text)).getAttribute('class');
        // The poster carries its terms as body text. Crop it or clamp its height and the visitor is
        // reading half a sentence — which is why this block was exempted from the density pass.
        expect(cls).toMatch(/h-auto/);
        expect(cls).toMatch(/w-full/);
        expect(cls).toMatch(/max-w-full/);
        expect(cls).not.toMatch(/object-cover|line-clamp|max-h-/);
    });

    it('keeps the "Promo" disclosure legible — lighter is allowed, smaller and quieter are not', async () => {
        aPromo();

        render(<PromoBanner placement="popup" cameraId={11} />);

        const cls = (await screen.findByText('Promo')).getAttribute('class');
        // This label is the same shape as the offer card's "Toko rekanan" and the ad slots'
        // "Iklan": commercial content on a public surface says so, in the same place, every time.
        // The density pass dropped font-medium; it may not go further than weight.
        expect(cls).toMatch(/text-xs/);
        expect(cls).toMatch(/text-content-subtle/);
        expect(cls).toMatch(/uppercase/);
        // Nothing below text-xs (an arbitrary text-[10px] would be exactly that), and never hidden.
        expect(cls).not.toMatch(/text-\[\d+px\]/);
        expect(cls).not.toMatch(/sr-only|\bhidden\b|opacity-/);
    });

    it('keeps the CTA below the poster, full-width, and unchanged by the pass', async () => {
        aPromo();

        render(<PromoBanner placement="popup" cameraId={11} />);

        const cls = (await screen.findByRole('link', { name: /Tanya Pemasangan/i })).getAttribute('class');
        // Full-width IS right here: this is the poster's own call to action at the end of the block,
        // not a button competing with a live video the way the offer card's CTA was.
        expect(cls).toMatch(/w-full/);
        expect(cls).toMatch(/mt-2/);
        expect(cls).toMatch(/bg-primary/);
    });

    it('leaves NO chrome behind when there is no promo — the host classes ride on the poster', async () => {
        getPublicPromoBanner.mockResolvedValue({ success: true, data: null });

        const { container } = render(
            <PromoBanner placement="popup" cameraId={11} className="border-t border-edge px-3 py-3" />
        );

        await waitFor(() => expect(getPublicPromoBanner).toHaveBeenCalled());
        // Otherwise every camera without a promo — the common case — gets an empty bordered box and
        // a block of padding under its video.
        expect(container.firstChild.getAttribute('class')).toBeNull();
        expect(container.textContent).toBe('');
    });

    it('wears the host surface classes once a promo has landed', async () => {
        aPromo();

        const { container } = render(
            <PromoBanner placement="popup" cameraId={11} className="border-t border-edge px-3 py-3" />
        );

        await screen.findByAltText(PROMO.alt_text);
        expect(container.firstChild.getAttribute('class')).toBe('border-t border-edge px-3 py-3');
    });

    it('uses semantic tokens only and never paints a promo as a fault', async () => {
        aPromo();

        const { container } = render(<PromoBanner placement="popup" cameraId={11} />);
        await screen.findByAltText(PROMO.alt_text);

        const classes = classNames(container);
        expect(classes).not.toMatch(/(?:^|[\s"'])(?:bg|text|border)-gray-\d/);
        expect(classes).not.toMatch(/(?:^|[\s"'])(?:dark|light)-\d/);
        // status-fault is red and reserved for genuine faults. An advertisement is not one.
        expect(classes).not.toMatch(/status-fault/);
    });

    it('keeps the mobile hard rules on the inline block', async () => {
        aPromo();

        const { container } = render(<PromoBanner placement="popup" cameraId={11} />);
        await screen.findByAltText(PROMO.alt_text);

        // No iframe/embed on a public mobile surface — they walk straight through the root
        // overflow-x guard.
        expect(container.querySelector('iframe, embed, object')).toBeNull();
        // Nothing sized in viewport units and nothing position-fixed while the lightbox is closed.
        expect(classNames(container)).not.toMatch(/w-screen|100vw|\bfixed\b/);
    });

    it('sizes the full-screen view with insets, never with 100vw', async () => {
        aPromo();

        render(<PromoBanner placement="popup" cameraId={11} />);
        fireEvent.click(await screen.findByRole('button', { name: /Lihat promo lebih besar/i }));

        const overlay = document.querySelector('.fixed');
        // A fixed element escapes the root overflow-x guard, and 100vw grows with the very overflow
        // it causes — so the overlay is pinned by insets and the dialog is capped by max-w.
        expect(overlay.getAttribute('class')).toMatch(/inset-0/);
        expect(overlay.getAttribute('class')).not.toMatch(/w-screen|100vw/);
        expect(screen.getByRole('dialog').getAttribute('class')).toMatch(/max-w-3xl/);
        expect(classNames(document.body)).not.toMatch(/w-screen|100vw/);
    });
});
