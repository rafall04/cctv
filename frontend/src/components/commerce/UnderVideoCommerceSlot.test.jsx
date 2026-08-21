/*
 * UnderVideoCommerceSlot.test.jsx — the commercial strip directly under the live video.
 *
 * ── WHAT CHANGED, AND WHY THESE TESTS WERE REWRITTEN (2026-08-21) ─────────────────────────────
 * This slot used to ARBITRATE: affiliate offer OR house promo, never both, on the theory that five
 * blocks already sat under the video and the popup has a history of becoming unusable at 390px.
 * The reasoning was sound; the premise was never measured. Checked on a real Android phone, the
 * offer card is a title, an optional photo and a button — far lighter than a poster — and both fit.
 *
 * So the promo did not lose the slot, it MOVED: VideoPopup now mounts this slot directly under the
 * video and <PromoBanner> separately, below CameraDetailPanel. Both are visible; they are no longer
 * mutually exclusive. Every assertion of the form "the promo must not render" or "never both at
 * once" was therefore testing a design that no longer exists, and has been dropped.
 *
 * What survived is everything that is still true, and it is the load-bearing half:
 *   · the resolve is DEFERRED behind an IntersectionObserver and fires at most once per mount —
 *     that GET is what counts the impression server-side, so it must mean "the block reached the
 *     screen", not "a popup opened",
 *   · nothing renders while the fetch is in flight — no skeleton, no reserved box, because the slot
 *     sits under a starting video and the majority of cameras have no offer,
 *   · with no offer there is no strip AT ALL: the chrome lives on the inner div, so an empty slot
 *     leaves no bare bordered box under the video,
 *   · switching camera invalidates the answer,
 *   · a failed resolve is indistinguishable from "no offer" — a visitor never sees an error for a
 *     shop link that did not load.
 *
 * promoBannerService is still mocked, and asserted NEVER CALLED. Not arbitration — a
 * re-introduction guard: if anyone remounts PromoBanner inside this slot, it fetches through that
 * service and this file fails, which is the cheapest possible alarm for "the promo is stacked under
 * the video again".
 *
 * Plain DOM assertions on purpose: this project does not load @testing-library/jest-dom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import UnderVideoCommerceSlot from './UnderVideoCommerceSlot';

const { resolveAffiliateOfferOnce } = vi.hoisted(() => ({
    resolveAffiliateOfferOnce: vi.fn(),
}));
const { getPublicPromoBanner, trackPromoBannerClick } = vi.hoisted(() => ({
    getPublicPromoBanner: vi.fn(),
    trackPromoBannerClick: vi.fn(),
}));

vi.mock('../../services/affiliateService', () => ({ resolveAffiliateOfferOnce }));
vi.mock('../../services/promoBannerService', () => ({ getPublicPromoBanner, trackPromoBannerClick }));

/** The thirteen-key public payload (v2). */
const OFFER = {
    id: 12,
    product_title: 'Kamera IP Outdoor 3MP',
    description: 'Tahan hujan, night vision 30 meter.',
    store_name: 'Toko Sinar Elektronik',
    product_url: 'https://toko-sinar.example/produk/kamera-ip-3mp',
    store_url: 'https://toko-sinar.example',
    product_href: '/api/public/affiliate/offers/12/go?l=p',
    store_href: '/api/public/affiliate/offers/12/go?l=s',
    whatsapp_url: 'https://wa.me/6281234567890?text=Halo',
    price_rupiah: 150000,
    image_base: null,
    image_width: null,
    image_height: null,
};

const SLOT_CLASSES = 'border-t border-edge bg-surface px-3 py-3';
const SLOT_SELECTOR = `.${SLOT_CLASSES.split(' ').join('.')}`;

const noOffer = () => resolveAffiliateOfferOnce.mockResolvedValue({ success: true, data: null });
const anOffer = (offer = OFFER) => resolveAffiliateOfferOnce.mockResolvedValue({ success: true, data: offer });

const affiliateIsShowing = () => screen.queryByTestId('affiliate-offer-card') !== null;

/**
 * Let every pending effect and resolved promise land before asserting a NEGATIVE.
 *
 * findBy* resolves from a MutationObserver callback, which is a microtask scheduled during the
 * commit — it can therefore run BEFORE React flushes passive effects, so an assertion made straight
 * after a findBy may be reading a moment at which a wrongly mounted child simply had not reached
 * its effect yet.
 */
const settle = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    // jsdom implements no IntersectionObserver, so the component falls back to fetching
    // immediately — the behaviour most of these tests want. The deferral itself is stubbed
    // explicitly in its own test.
    delete globalThis.IntersectionObserver;
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('UnderVideoCommerceSlot — one occupant, and it is the offer', () => {
    it('fills the strip with the resolved affiliate offer', async () => {
        anOffer();

        render(<UnderVideoCommerceSlot cameraId={11} />);

        await screen.findByTestId('affiliate-offer-card');
        expect(screen.getByText(OFFER.product_title)).not.toBeNull();
        expect(screen.getByText('Toko rekanan')).not.toBeNull();
    });

    it('does not render the house promo — that block moved below CameraDetailPanel', async () => {
        anOffer();

        render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');
        await settle();

        // Not arbitration (both are visible in VideoPopup now, one under the video and one under
        // the metadata) — this asserts OWNERSHIP: PromoBanner is not mounted HERE, so it neither
        // fetches nor counts an impression from inside this strip.
        expect(getPublicPromoBanner).not.toHaveBeenCalled();
        expect(screen.queryByText('Promo')).toBeNull();
    });

    it('does not summon the promo when there is no offer either — an empty slot stays empty', async () => {
        noOffer();

        const { container } = render(<UnderVideoCommerceSlot cameraId={11} />);
        await waitFor(() => expect(resolveAffiliateOfferOnce).toHaveBeenCalled());
        await settle();

        expect(getPublicPromoBanner).not.toHaveBeenCalled();
        expect(container.textContent).toBe('');
    });

    it('hands the offer through to the card as payload v2 — real shop URL, not the redirector', async () => {
        anOffer();

        render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');

        const product = screen.getByRole('link', { name: /Lihat barang/i });
        expect(product.getAttribute('href')).toBe(OFFER.product_url);
        expect(product.getAttribute('href').startsWith('/api/public/affiliate/')).toBe(false);
    });
});

describe('UnderVideoCommerceSlot — the empty strip', () => {
    it('draws no bordered strip when no offer resolves', async () => {
        noOffer();

        const { container } = render(<UnderVideoCommerceSlot cameraId={11} />);

        await waitFor(() => expect(resolveAffiliateOfferOnce).toHaveBeenCalled());
        await settle();

        // Load-bearing: the strip's chrome lives on the INNER div, rendered only once an offer
        // exists. Move it to the outer wrapper and every camera without an offer — the common case
        // — gets an empty bordered box under the video.
        expect(container.querySelector('.border-t')).toBeNull();
        expect(container.querySelector('.bg-surface')).toBeNull();
        expect(screen.getByTestId('under-video-commerce-slot').getAttribute('class')).toBeNull();
        expect(container.textContent).toBe('');
    });

    it('renders nothing at all while the resolve is still in flight', async () => {
        let release;
        resolveAffiliateOfferOnce.mockReturnValue(new Promise((resolve) => { release = resolve; }));

        const { container } = render(<UnderVideoCommerceSlot cameraId={11} />);
        await settle();

        // No skeleton, no reserved box: a placeholder that resolves to "nothing" is a layout shift
        // on the majority of cameras, directly under a video that is still starting.
        expect(container.textContent).toBe('');
        expect(container.querySelector(SLOT_SELECTOR)).toBeNull();

        await act(async () => { release({ success: true, data: OFFER }); });
        await screen.findByTestId('affiliate-offer-card');
    });

    it('wears the strip chrome only around a real offer', async () => {
        anOffer();

        const { container } = render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');

        const strip = container.querySelector(`[data-testid="under-video-commerce-slot"] > ${SLOT_SELECTOR}`);
        expect(strip).not.toBeNull();
        expect(strip.querySelector('[data-testid="affiliate-offer-card"]')).not.toBeNull();
        expect(screen.getByTestId('under-video-commerce-slot').getAttribute('class')).toBeNull();
    });

    it('degrades silently when the resolve fails — a visitor never sees an error for a shop link', async () => {
        resolveAffiliateOfferOnce.mockResolvedValue({ success: false, message: 'boom' });

        const { container } = render(<UnderVideoCommerceSlot cameraId={11} />);
        await waitFor(() => expect(resolveAffiliateOfferOnce).toHaveBeenCalled());
        await settle();

        expect(screen.queryByText(/boom/)).toBeNull();
        expect(affiliateIsShowing()).toBe(false);
        expect(container.textContent).toBe('');
    });
});

describe('UnderVideoCommerceSlot — resolving', () => {
    it('asks for this surface and this camera', async () => {
        noOffer();

        render(<UnderVideoCommerceSlot cameraId={42} />);

        await waitFor(() => expect(resolveAffiliateOfferOnce).toHaveBeenCalledWith({
            placement: 'popup',
            cameraId: 42,
        }));
    });

    it('drops the previous camera\'s offer and re-resolves when the camera changes', async () => {
        anOffer();

        const { rerender } = render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');

        noOffer();
        rerender(<UnderVideoCommerceSlot cameraId={12} />);

        // An offer bought for camera 11 must never linger over camera 12.
        await waitFor(() => expect(affiliateIsShowing()).toBe(false));
        expect(resolveAffiliateOfferOnce).toHaveBeenLastCalledWith({ placement: 'popup', cameraId: 12 });
    });

    it('waits for the strip to approach the viewport before resolving, and asks only once', async () => {
        /*
         * The fake honours disconnect() the way a real observer does — it stops delivering — so
         * "asks only once" is a claim about the component, not about the stub. Without that, firing
         * the callback by hand after a disconnect would prove nothing.
         */
        let deliver = null;
        const disconnect = vi.fn();
        const observe = vi.fn();
        vi.stubGlobal('IntersectionObserver', vi.fn(function FakeObserver(callback) {
            deliver = callback;
            this.observe = observe;
            this.disconnect = () => {
                deliver = null;
                disconnect();
            };
        }));
        const fire = async (isIntersecting) => {
            await act(async () => {
                if (deliver) {
                    deliver([{ isIntersecting }]);
                }
            });
        };
        anOffer();

        render(<UnderVideoCommerceSlot cameraId={11} />);

        // The resolve GET is what counts the impression server-side, so it must not fire merely
        // because a popup opened.
        expect(observe).toHaveBeenCalledTimes(1);
        expect(resolveAffiliateOfferOnce).not.toHaveBeenCalled();

        await fire(false);
        expect(resolveAffiliateOfferOnce).not.toHaveBeenCalled();

        await fire(true);
        await screen.findByTestId('affiliate-offer-card');

        // Disconnected BEFORE loading: scrolling the popup cannot queue a second impression.
        expect(disconnect).toHaveBeenCalled();
        await fire(true);
        expect(resolveAffiliateOfferOnce).toHaveBeenCalledTimes(1);
    });
});
