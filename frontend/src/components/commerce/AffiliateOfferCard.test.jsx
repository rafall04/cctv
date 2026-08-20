/*
 * AffiliateOfferCard.test.jsx — the paid "Toko rekanan" card.
 *
 * What is actually under test here is not layout, it is the four properties that make a paid link
 * on a public-institution-adjacent domain defensible:
 *   1. the honesty label is present,
 *   2. the outbound anchors are disclosed to search engines (nofollow + sponsored) and cannot hand
 *      the destination a window handle or a Referer (noopener + noreferrer),
 *   3. the hrefs are used VERBATIM from the payload — the component never assembles a partner URL,
 *      because our own /go redirector is what re-checks the offer, the partner and the schedule on
 *      read, and a client-built link would bypass all three,
 *   4. the optional store link disappears cleanly when the partner has no shop URL.
 *
 * Plain DOM assertions on purpose: this project does not load @testing-library/jest-dom.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AffiliateOfferCard from './AffiliateOfferCard';

/** The six-key public payload, exactly as the backend hand-builds it. Nothing else may be here. */
const OFFER = {
    id: 12,
    product_title: 'Kamera IP Outdoor 3MP',
    description: 'Tahan hujan, night vision 30 meter, garansi resmi satu tahun.',
    store_name: 'Toko Sinar Elektronik',
    product_href: '/api/public/affiliate/offers/12/go?l=p',
    store_href: '/api/public/affiliate/offers/12/go?l=s',
};

/** rel is asserted as a SET of tokens, so word order in the attribute is free to change. */
const relTokens = (link) => (link.getAttribute('rel') || '').split(/\s+/).filter(Boolean);

const productLink = () => screen.getByRole('link', { name: /Lihat barang/i });

describe('AffiliateOfferCard', () => {
    it('shows the "Toko rekanan" honesty label — commercial content on a public surface says so', () => {
        render(<AffiliateOfferCard offer={OFFER} />);

        expect(screen.getByText('Toko rekanan')).not.toBeNull();
    });

    it('renders the partner copy it was given', () => {
        render(<AffiliateOfferCard offer={OFFER} />);

        expect(screen.getByText(OFFER.product_title)).not.toBeNull();
        expect(screen.getByText(OFFER.description)).not.toBeNull();
        expect(screen.getByText(OFFER.store_name)).not.toBeNull();
    });

    it('uses the product href verbatim — no client-side URL construction', () => {
        render(<AffiliateOfferCard offer={OFFER} />);

        // toBe, not toContain: any prefixing, re-encoding or query rewriting here would mean the
        // component is building links instead of following the redirector the backend minted.
        expect(productLink().getAttribute('href')).toBe(OFFER.product_href);
    });

    it('uses the store href verbatim too', () => {
        render(<AffiliateOfferCard offer={OFFER} />);

        const store = screen.getByRole('link', { name: new RegExp(OFFER.store_name, 'i') });
        expect(store.getAttribute('href')).toBe(OFFER.store_href);
    });

    it('never renders the partner\'s own URL, only our redirector path', () => {
        // Defence in depth against a future "helpfully" de-referenced href: the raw outbound URL is
        // deliberately kept off the public wire, so nothing on this card may point off-origin.
        render(<AffiliateOfferCard offer={OFFER} />);

        for (const link of screen.getAllByRole('link')) {
            expect(link.getAttribute('href').startsWith('/api/public/affiliate/offers/')).toBe(true);
        }
    });

    it.each([
        ['product', () => productLink()],
        ['store', () => screen.getByRole('link', { name: new RegExp(OFFER.store_name, 'i') })],
    ])('opens the %s link in a new tab with all four rel tokens', (_label, getLink) => {
        render(<AffiliateOfferCard offer={OFFER} />);

        const link = getLink();
        expect(link.getAttribute('target')).toBe('_blank');

        const rel = relTokens(link);
        // noopener/noreferrer: a third-party tab must not get a handle on this window, and the
        // Referer must not leak (nginx sets Referrer-Policy at server level, so the app cannot).
        expect(rel).toContain('noopener');
        expect(rel).toContain('noreferrer');
        // nofollow/sponsored: this is a PAID placement. Anything less is undisclosed link-selling.
        expect(rel).toContain('nofollow');
        expect(rel).toContain('sponsored');
    });

    it('drops the store link entirely when the partner has no shop URL', () => {
        render(<AffiliateOfferCard offer={{ ...OFFER, store_href: null }} />);

        const links = screen.getAllByRole('link');
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute('href')).toBe(OFFER.product_href);
        expect(screen.queryByText(OFFER.store_name)).toBeNull();
    });

    it('still labels the store link when the partner has a URL but no name', () => {
        render(<AffiliateOfferCard offer={{ ...OFFER, store_name: null }} />);

        const store = screen.getByRole('link', { name: /Kunjungi toko/i });
        expect(store.getAttribute('href')).toBe(OFFER.store_href);
    });

    it('omits the description block when the partner supplied none', () => {
        render(<AffiliateOfferCard offer={{ ...OFFER, description: null }} />);

        expect(screen.queryByText(OFFER.description)).toBeNull();
        expect(screen.getByText(OFFER.product_title)).not.toBeNull();
    });

    it.each([
        ['no offer at all', undefined],
        ['a null offer', null],
        ['an offer with no title', { ...OFFER, product_title: '' }],
        ['an offer with no product href', { ...OFFER, product_href: null }],
    ])('renders nothing for %s rather than an empty card', (_label, offer) => {
        const { container } = render(<AffiliateOfferCard offer={offer} />);

        expect(container.querySelector('[data-testid="affiliate-offer-card"]')).toBeNull();
        expect(container.textContent).toBe('');
    });

    it('wears the wrapper classes the host slot hands it', () => {
        const { container } = render(<AffiliateOfferCard offer={OFFER} className="border-t border-edge" />);

        const card = container.querySelector('[data-testid="affiliate-offer-card"]');
        expect(card.getAttribute('class')).toBe('border-t border-edge');
    });

    it('never paints itself as a fault — a shop link is not an error state', () => {
        const { container } = render(<AffiliateOfferCard offer={OFFER} />);

        expect(container.innerHTML).not.toMatch(/status-fault/);
    });

    it('keeps the mobile hard rules: no embeds, wrapping action row, tappable truncating labels', () => {
        const { container } = render(<AffiliateOfferCard offer={OFFER} />);

        // No iframe/embed anywhere on a public mobile surface — they walk straight through the
        // root overflow-x guard.
        expect(container.querySelector('iframe, embed, object')).toBeNull();
        // The two-button row is the classic overflow at Android 1.3x font scaling.
        expect(container.querySelector('.flex-wrap')).not.toBeNull();

        for (const link of screen.getAllByRole('link')) {
            const cls = link.getAttribute('class');
            expect(cls).toMatch(/min-h-\[40px\]/);
            expect(cls).toMatch(/min-w-0/);
            expect(link.querySelector('.truncate')).not.toBeNull();
        }
    });
});
