/*
 * UnderVideoCommerceSlot.test.jsx — arbitration for the single commercial strip under the live video.
 *
 * The one invariant worth a test file: this slot has exactly ONE occupant. A paid affiliate offer
 * takes it when one resolves; the operator's own installation promo takes it otherwise; the two
 * never appear together, and when neither resolves the strip must not exist at all — no bare
 * bordered box under the video on the majority of cameras.
 *
 * PromoBanner is rendered FOR REAL here (only its service is stubbed) rather than mocked out. That
 * is deliberate: mocking the component would prove the slot rendered *something*, while what the
 * arbitration rule is actually about is whether the promo gets to fetch, count an impression and
 * paint. Stubbing the service lets the test observe all three.
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

const OFFER = {
    id: 12,
    product_title: 'Kamera IP Outdoor 3MP',
    description: 'Tahan hujan, night vision 30 meter.',
    store_name: 'Toko Sinar Elektronik',
    product_href: '/api/public/affiliate/offers/12/go?l=p',
    store_href: '/api/public/affiliate/offers/12/go?l=s',
};

const PROMO = {
    id: 7,
    title: 'Pemasangan CCTV Gratis',
    alt_text: 'Promo pemasangan CCTV gratis',
    image_base: 'promo-0123456789ab',
    image_width: 1200,
    image_height: 894,
    cta_label: 'Tanya Pemasangan',
    cta_url: 'https://wa.me/6281234567890?text=Halo',
};

const SLOT_CLASSES = 'border-t border-edge bg-surface px-3 py-3';

const noOffer = () => resolveAffiliateOfferOnce.mockResolvedValue({ success: true, data: null });
const anOffer = (offer = OFFER) => resolveAffiliateOfferOnce.mockResolvedValue({ success: true, data: offer });
const noPromo = () => getPublicPromoBanner.mockResolvedValue({ success: true, data: null });
const aPromo = () => getPublicPromoBanner.mockResolvedValue({ success: true, data: PROMO });

/** Did PromoBanner actually paint? Its label and its poster are the only visible evidence. */
const promoIsShowing = () => screen.queryByText('Promo') !== null || screen.queryByAltText(PROMO.alt_text) !== null;
const affiliateIsShowing = () => screen.queryByTestId('affiliate-offer-card') !== null;

/**
 * Let every pending effect and resolved promise land before asserting a NEGATIVE.
 *
 * findBy* resolves from a MutationObserver callback, which is a microtask scheduled during the
 * commit — it can therefore run BEFORE React flushes passive effects. Assert "the promo never
 * fetched" straight after a findBy and the assertion may be reading a moment at which a wrongly
 * mounted PromoBanner simply had not got to its effect yet. Verified: without this flush, seeding
 * the component with `{resolved && (…)}` (both branches at once) still passed intermittently.
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
    // jsdom implements no IntersectionObserver; both components then fetch immediately, which is
    // the behaviour most of these tests want. The deferral itself is stubbed explicitly below.
    delete globalThis.IntersectionObserver;
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('UnderVideoCommerceSlot — arbitration', () => {
    it('gives the slot to the affiliate offer, and the promo does not render', async () => {
        anOffer();
        aPromo(); // a promo IS available — it must still lose

        render(<UnderVideoCommerceSlot cameraId={11} />);

        await screen.findByTestId('affiliate-offer-card');
        expect(screen.getByText(OFFER.product_title)).not.toBeNull();
        await settle();

        // The explicit negative. Not just "no promo pixels": PromoBanner is never mounted, so it
        // never fetches and never counts an impression for a slot it did not get.
        expect(promoIsShowing()).toBe(false);
        expect(getPublicPromoBanner).not.toHaveBeenCalled();
    });

    it('gives the slot to the promo when no offer resolves, and the affiliate card does not render', async () => {
        noOffer();
        aPromo();

        render(<UnderVideoCommerceSlot cameraId={11} />);

        expect(await screen.findByAltText(PROMO.alt_text)).not.toBeNull();
        expect(screen.getByText('Promo')).not.toBeNull();
        await settle();

        // The other explicit negative.
        expect(affiliateIsShowing()).toBe(false);
        expect(screen.queryByText('Toko rekanan')).toBeNull();
    });

    it('never shows both at once, whichever resolves', async () => {
        anOffer();
        aPromo();

        const { rerender } = render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');
        await settle();
        expect(affiliateIsShowing()).toBe(true);
        expect(promoIsShowing()).toBe(false);

        noOffer();
        rerender(<UnderVideoCommerceSlot cameraId={12} />);
        await screen.findByAltText(PROMO.alt_text);
        await settle();
        expect(promoIsShowing()).toBe(true);
        expect(affiliateIsShowing()).toBe(false);
    });

    it('treats a failed affiliate resolve exactly like "no offer" — the promo takes the slot', async () => {
        resolveAffiliateOfferOnce.mockResolvedValue({ success: false, message: 'boom' });
        aPromo();

        render(<UnderVideoCommerceSlot cameraId={11} />);

        expect(await screen.findByAltText(PROMO.alt_text)).not.toBeNull();
        expect(screen.queryByText(/boom/)).toBeNull();
    });

    it('renders nothing at all while the affiliate resolve is still in flight', async () => {
        let release;
        resolveAffiliateOfferOnce.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        aPromo();

        const { container } = render(<UnderVideoCommerceSlot cameraId={11} />);
        await settle();

        // No skeleton, no reserved box: the promo must not be mounted before it is known that the
        // affiliate offer did not take the slot, or its impression would be counted either way.
        expect(container.textContent).toBe('');
        expect(getPublicPromoBanner).not.toHaveBeenCalled();

        await act(async () => { release({ success: true, data: null }); });
        await screen.findByAltText(PROMO.alt_text);
    });
});

describe('UnderVideoCommerceSlot — the empty strip', () => {
    it('draws no bordered strip when there is neither an offer nor a promo', async () => {
        noOffer();
        noPromo();

        const { container } = render(<UnderVideoCommerceSlot cameraId={11} />);

        await waitFor(() => expect(getPublicPromoBanner).toHaveBeenCalled());

        // This is the load-bearing part: the strip's chrome is handed to PromoBanner as a prop
        // (which applies it only once a promo resolves) instead of being worn by an always-present
        // outer div here. Put it on an outer div and every camera with neither — the common case —
        // gets an empty bordered box under the video.
        expect(container.querySelector('.border-t')).toBeNull();
        expect(container.querySelector('.bg-surface')).toBeNull();
        expect(screen.getByTestId('under-video-commerce-slot').getAttribute('class')).toBeNull();
        expect(container.textContent).toBe('');
    });

    it('wears the strip chrome on the affiliate branch', async () => {
        anOffer();
        noPromo();

        const { container } = render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');

        const strip = container.querySelector(`[data-testid="under-video-commerce-slot"] > .${SLOT_CLASSES.split(' ').join('.')}`);
        expect(strip).not.toBeNull();
        expect(strip.querySelector('[data-testid="affiliate-offer-card"]')).not.toBeNull();
    });

    it('hands the same strip chrome to PromoBanner on the promo branch', async () => {
        noOffer();
        aPromo();

        const { container } = render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByAltText(PROMO.alt_text);

        const strip = container.querySelector(`.${SLOT_CLASSES.split(' ').join('.')}`);
        expect(strip).not.toBeNull();
        // Worn by PromoBanner's own wrapper, not by this component's outer div.
        expect(strip.getAttribute('data-testid')).toBeNull();
        expect(screen.getByTestId('under-video-commerce-slot').getAttribute('class')).toBeNull();
    });
});

describe('UnderVideoCommerceSlot — outbound anchors', () => {
    it('ships the affiliate anchors with target=_blank and all four rel tokens', async () => {
        anOffer();
        noPromo();

        render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');

        const links = screen.getAllByRole('link');
        expect(links.length).toBe(2);
        for (const link of links) {
            expect(link.getAttribute('target')).toBe('_blank');
            const rel = (link.getAttribute('rel') || '').split(/\s+/);
            expect(rel).toContain('noopener');
            expect(rel).toContain('noreferrer');
            expect(rel).toContain('nofollow');
            expect(rel).toContain('sponsored');
        }
    });

    it('uses the payload hrefs verbatim — the slot builds no partner URL of its own', async () => {
        anOffer();
        noPromo();

        render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');

        expect(screen.getByRole('link', { name: /Lihat barang/i }).getAttribute('href')).toBe(OFFER.product_href);
        expect(screen.getByRole('link', { name: /Toko Sinar Elektronik/i }).getAttribute('href')).toBe(OFFER.store_href);
    });

    it('shows only the product link when the partner has no store URL', async () => {
        anOffer({ ...OFFER, store_href: null });
        noPromo();

        render(<UnderVideoCommerceSlot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');

        const links = screen.getAllByRole('link');
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute('href')).toBe(OFFER.product_href);
    });
});

describe('UnderVideoCommerceSlot — resolving', () => {
    it('asks for this surface and this camera', async () => {
        noOffer();
        noPromo();

        render(<UnderVideoCommerceSlot cameraId={42} />);

        await waitFor(() => expect(resolveAffiliateOfferOnce).toHaveBeenCalledWith({
            placement: 'popup',
            cameraId: 42,
        }));
    });

    it('drops the previous camera\'s offer and re-resolves when the camera changes', async () => {
        anOffer();
        noPromo();

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
        noPromo();

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
