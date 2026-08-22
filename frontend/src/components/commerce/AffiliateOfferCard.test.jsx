/*
 * AffiliateOfferCard.test.jsx — the paid "Toko rekanan" card.
 *
 * Six properties are under test here. Pixel layout is not one of them — but the five ARRANGEMENT
 * facts in (6) are, because each of them is a rule the density pass has to keep, not a taste.
 *
 *  1. PRESENCE IS THE SWITCH. Photo, price, WhatsApp button and store link each appear only when
 *     their own field arrived, and vanish when the operator clears it. There is no show_x boolean
 *     anywhere in this feature and there must never be one, so every one of the four is asserted
 *     BOTH ways — present and cleared. This is the operator's literal requirement ("pastikan bisa
 *     di-customize muncul tidaknya") and the only thing standing between it and a regression.
 *
 *  2. THE ANCHOR CARRIES THE REAL SHOP URL. Phase 1 pointed it at our own /go redirector. This
 *     site's PWA manifest is scope "/" + display "standalone", so a relative /go href is IN SCOPE:
 *     an installed PWA follows the 302 itself and parks the visitor on a stranger's shop inside our
 *     shell with no address bar and no way back (there is exactly one origin to escape to, and
 *     api-cctv.raf.my.id is NXDOMAIN). An absolute https:// href is OUT of scope, so Android hands
 *     it to the browser. That is why `toBe(offer.product_url)` below is asserted alongside an
 *     explicit "and it is NOT a /api/public/affiliate/… path": either half alone would still pass
 *     while the bug was back.
 *
 *  3. THE COUNT IS FIRED EXACTLY ONCE PER TAP, AND NEVER DELAYS THE TAP. When the href leaves our
 *     origin nothing server-side sees the click, so onClick beacons it. On the /go fallback the
 *     302 counts it and the beacon must stay silent — firing both files one tap as two, on a number
 *     that goes on an invoice. And the anchor's default navigation must survive: a counter that
 *     swallowed the visitor's click would be trading their trip for our bookkeeping.
 *
 *  4. THE OUTBOUND ANCHORS ARE DISCLOSED AND DECLAWED — nofollow + sponsored (a PAID placement on a
 *     public-institution-adjacent domain; anything less is undisclosed link-selling) and
 *     noopener + noreferrer (a third-party tab gets no handle on this window and no Referer). All
 *     four tokens are asserted individually, on every anchor, because a partial rel is the failure
 *     mode nobody notices.
 *
 *  5. THE HONESTY LABEL AND THE MOBILE HARD RULES hold: "Toko rekanan" is present, nothing is a
 *     fault (`status-fault` is red and a shop link is not an error), nothing is an iframe, and the
 *     action row wraps with truncating labels because Android font scaling at 1.3x is how a row of
 *     buttons grows wider than the viewport.
 *
 *  6. THE DENSITY PASS (2026-08-21) HOLDS. This card sits under a starting live video, and the
 *     arrangement is what keeps it from competing with the stream. Five facts, each asserted:
 *       · ONE action row. The CTA, WhatsApp and both utilities share it; the CTA is sized to its
 *         content instead of `w-full`, so it still reads as primary without being the loudest thing
 *         on the screen.
 *       · COPY AND SHARE ARE ICON-ONLY, AND STILL NAMED. Dropping the visible label costs a screen
 *         reader everything unless the accessible name carries it, so "Salin link barang" /
 *         "Bagikan barang" are asserted verbatim. They are also what disambiguates this card's
 *         share from the CAMERA's "Bagikan" chip a few pixels above it: same verb, different
 *         object, and only the accessible name says which.
 *       · TITLE AND PRICE SHARE ONE LINE — title yields (`min-w-0 flex-1 truncate`), price never
 *         does (`shrink-0 tabular-nums`). Asserted as classes AND as a shared parent, because
 *         either one alone can be true while the line is broken.
 *       · THE PHOTO IS A FIXED SQUARE WITH INTRINSIC DIMENSIONS. width/height reserve the box before
 *         the bytes land (no layout shift under a starting video) and the fixed box stops a portrait
 *         upload from making the card as tall as the phone.
 *       · THE SHOP LINK RIDES THE DISCLOSURE ROW, next to "Toko rekanan" — the disclosure and the
 *         shop it discloses are one thought, and it frees the action row to hold exactly four
 *         controls.
 *
 * affiliateService is mocked so the beacon is observable and no network transport is involved; the
 * letters it is called with ('p'/'s'/'w') are checked against the REAL module in one test, so the
 * mock cannot drift away from the contract it is standing in for.
 *
 * Plain DOM assertions on purpose: this project does not load @testing-library/jest-dom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AffiliateOfferCard from './AffiliateOfferCard';

const { countAffiliateClick } = vi.hoisted(() => ({ countAffiliateClick: vi.fn() }));

vi.mock('../../services/affiliateService', () => ({
    countAffiliateClick,
    AFFILIATE_LINK: Object.freeze({ PRODUCT: 'p', STORE: 's', WHATSAPP: 'w' }),
}));

/** The thirteen-key public payload (v2), exactly as the backend hand-builds it. */
const OFFER = {
    id: 12,
    product_title: 'Kamera IP Outdoor 3MP',
    description: 'Tahan hujan, night vision 30 meter, garansi resmi satu tahun.',
    store_name: 'Toko Sinar Elektronik',
    product_url: 'https://toko-sinar.example/produk/kamera-ip-3mp',
    store_url: 'https://toko-sinar.example',
    product_href: '/api/public/affiliate/offers/12/go?l=p',
    store_href: '/api/public/affiliate/offers/12/go?l=s',
    whatsapp_url: 'https://wa.me/6281234567890?text=Halo%2C%20saya%20mau%20tanya',
    price_rupiah: 150000,
    image_base: 'aff-0123456789ab',
    image_width: 320,
    image_height: 240,
};

/** How the backend expresses "this offer has no shop page": both halves go, never just one. */
const NO_STORE = { store_url: null, store_href: null };

const GO_PREFIX = '/api/public/affiliate/offers/';

/** rel is asserted as a SET of tokens, so word order in the attribute is free to change. */
const relTokens = (link) => (link.getAttribute('rel') || '').split(/\s+/).filter(Boolean);

const productLink = () => screen.getByRole('link', { name: /Lihat barang/i });
const storeLink = () => screen.getByRole('link', { name: /Buka toko/i });
const whatsappLink = () => screen.getByRole('link', { name: /WhatsApp/i });

/*
 * Rendered as placement="area", deliberately NOT "popup": the card takes the surface from its host
 * slot and stamps it on every beacon, and a fixture using the historical default would still pass
 * if someone hardcoded 'popup' back into the counting path.
 */
const show = (patch) => render(<AffiliateOfferCard offer={{ ...OFFER, ...patch }} placement="area" />);

/**
 * Click an anchor and report whether its default navigation survived.
 *
 * fireEvent returns the dispatchEvent result, which is false exactly when something called
 * preventDefault. That is the assertion that matters: the visitor asked to go to the shop, and the
 * counting beacon is our business, not theirs.
 */
const clickAndKeepDefault = (element) => fireEvent.click(element);

/** navigator.clipboard / navigator.share do not exist in jsdom; install and remove them per test. */
const stubNavigator = (key, value) => {
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
};
const unstubNavigator = (key) => {
    if (key in navigator) {
        delete navigator[key];
    }
};

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    unstubNavigator('clipboard');
    unstubNavigator('share');
});

describe('AffiliateOfferCard — presence is the switch: the photo', () => {
    it('renders the WebP thumbnail, both renditions, when the operator uploaded one', () => {
        const { container } = show();

        const img = container.querySelector('img');
        expect(img).not.toBeNull();
        expect(img.getAttribute('src')).toBe(`/api/affiliate-media/${OFFER.image_base}-320.webp`);
        // 1x and 2x of the 64/80px thumbnail box — the backend generates exactly these two and
        // nothing larger, because this loads under a live video where every kilobyte competes.
        expect(img.getAttribute('srcset')).toContain(`/api/affiliate-media/${OFFER.image_base}-160.webp 160w`);
        expect(img.getAttribute('srcset')).toContain(`/api/affiliate-media/${OFFER.image_base}-320.webp 320w`);
        // Dimensions reserve the box before the bytes land: no layout shift under a starting video.
        expect(img.getAttribute('width')).toBe(String(OFFER.image_width));
        expect(img.getAttribute('height')).toBe(String(OFFER.image_height));
        expect(img.getAttribute('alt')).toBe(OFFER.product_title);
        expect(img.getAttribute('loading')).toBe('lazy');
    });

    it('renders no photo at all once image_base is cleared — clearing the field IS the off switch', () => {
        const { container } = show({ image_base: null, image_width: null, image_height: null });

        expect(container.querySelector('img')).toBeNull();
        // The rest of the card is untouched: removing the photo must not remove the offer.
        expect(screen.getByText(OFFER.product_title)).not.toBeNull();
        expect(productLink()).not.toBeNull();
    });
});

describe('AffiliateOfferCard — presence is the switch: the price', () => {
    it('renders the price with Indonesian thousand separators', () => {
        show();

        expect(screen.getByTestId('affiliate-offer-price').textContent).toBe('Rp150.000');
    });

    it('groups larger amounts the same way', () => {
        show({ price_rupiah: 1250000 });

        expect(screen.getByTestId('affiliate-offer-price').textContent).toBe('Rp1.250.000');
    });

    it('renders a price of ZERO — 0 is a price, and truthiness is the trap here', () => {
        show({ price_rupiah: 0 });

        // `price_rupiah && …` or `|| null` anywhere on this path turns a free item into a missing
        // price. Money is INTEGER rupiah end to end, so 0 formats like any other amount.
        expect(screen.getByTestId('affiliate-offer-price').textContent).toBe('Rp0');
    });

    it('renders no price line when price_rupiah is null — null means "does not advertise a price"', () => {
        show({ price_rupiah: null });

        expect(screen.queryByTestId('affiliate-offer-price')).toBeNull();
    });

    it('null and 0 are visibly DIFFERENT states, not two spellings of "no price"', () => {
        const { container: withZero } = show({ price_rupiah: 0 });
        const zeroText = withZero.textContent;

        const { container: withNull } = show({ price_rupiah: null });

        expect(zeroText).toMatch(/Rp0/);
        expect(withNull.textContent).not.toMatch(/Rp0/);
    });
});

describe('AffiliateOfferCard — presence is the switch: the WhatsApp button', () => {
    it('shows the WhatsApp button when the partner supplied a number', () => {
        show();

        const link = whatsappLink();
        expect(link.getAttribute('href')).toBe(OFFER.whatsapp_url);
        expect(screen.getByText('Tanya')).not.toBeNull();
    });

    it('shortens the VISIBLE label to "Tanya" but keeps the long form in the accessible name', () => {
        show();

        // The density pass cut the visible label so four controls fit one row at 390px. What must
        // not be cut with it: which product this asks about, and that it opens WhatsApp — a link
        // announced as bare "Tanya" tells a screen-reader user nothing about where it leads.
        const link = whatsappLink();
        expect(link.getAttribute('aria-label')).toBe(`Tanya barang ini lewat WhatsApp: ${OFFER.product_title}`);
        // Long-press on a phone shows the title attribute, so it carries the same sentence.
        expect(link.getAttribute('title')).toBe(link.getAttribute('aria-label'));
        expect(screen.queryByText('Tanya barang ini')).toBeNull();
    });

    it('drops the WhatsApp button entirely once the number is cleared', () => {
        show({ whatsapp_url: null });

        expect(screen.queryByRole('link', { name: /WhatsApp/i })).toBeNull();
        expect(screen.queryByText('Tanya')).toBeNull();
    });
});

describe('AffiliateOfferCard — presence is the switch: the store link', () => {
    it('shows the shop link, labelled with the shop name, when there is a shop URL', () => {
        show();

        expect(storeLink().getAttribute('href')).toBe(OFFER.store_url);
        expect(screen.getByText(OFFER.store_name)).not.toBeNull();
    });

    it('drops the store link entirely when the partner has no shop URL', () => {
        show(NO_STORE);

        expect(screen.queryByRole('link', { name: /Buka toko/i })).toBeNull();
        expect(screen.queryByText(OFFER.store_name)).toBeNull();
        // Only the product and WhatsApp anchors remain.
        expect(screen.getAllByRole('link')).toHaveLength(2);
    });

    it('still labels the store link when there is a URL but no shop name', () => {
        show({ store_name: null });

        expect(screen.getByRole('link', { name: /Kunjungi toko/i }).getAttribute('href')).toBe(OFFER.store_url);
    });

    it('omits the description block when the partner supplied none', () => {
        show({ description: null });

        expect(screen.queryByText(OFFER.description)).toBeNull();
        expect(screen.getByText(OFFER.product_title)).not.toBeNull();
    });
});

describe('AffiliateOfferCard — presence is the switch, and nothing else is', () => {
    it('ignores show_* flags entirely — the field being there IS the switch', () => {
        // There is deliberately no show_photo / show_price anywhere in this feature, and this is the
        // guard against one appearing: two pieces of state describing one thing eventually disagree,
        // and the operator's requirement was "clear the field to hide it", not "tick a box".
        const { container } = show({ show_photo: false, show_price: false, show_whatsapp: false });

        expect(container.querySelector('img')).not.toBeNull();
        expect(screen.getByTestId('affiliate-offer-price')).not.toBeNull();
        expect(whatsappLink()).not.toBeNull();
    });
});

describe('AffiliateOfferCard — the anchor points at the real shop (the PWA fix)', () => {
    it('uses offer.product_url VERBATIM for "Lihat barang"', () => {
        show();

        // toBe, not toContain: any prefixing, re-encoding or query rewriting means the component is
        // building links instead of using the one the backend vouched for.
        expect(productLink().getAttribute('href')).toBe(OFFER.product_url);
    });

    it('does NOT point "Lihat barang" at our /go redirector when a real URL exists', () => {
        show();

        // The whole reason for payload v2. A relative /go href is inside the PWA scope, so an
        // installed PWA follows the 302 itself and traps the visitor on a third-party shop inside
        // our shell — no address bar, no back affordance, and no second origin to escape through.
        const href = productLink().getAttribute('href');
        expect(href.startsWith(GO_PREFIX)).toBe(false);
        expect(href.startsWith('https://')).toBe(true);
    });

    it('uses offer.store_url and offer.whatsapp_url verbatim too', () => {
        show();

        expect(storeLink().getAttribute('href')).toBe(OFFER.store_url);
        expect(storeLink().getAttribute('href').startsWith(GO_PREFIX)).toBe(false);
        expect(whatsappLink().getAttribute('href')).toBe(OFFER.whatsapp_url);
    });

    it('falls back to the /go redirector only when the backend could not vouch for the URL', () => {
        // The backend re-validates on the way out and emits null for anything doubtful. A
        // redirector inside the PWA shell is a poor experience; a dead card is a worse one.
        show({ product_url: null, store_url: null });

        expect(productLink().getAttribute('href')).toBe(OFFER.product_href);
        expect(storeLink().getAttribute('href')).toBe(OFFER.store_href);
    });
});

describe('AffiliateOfferCard — outbound anchors are disclosed and declawed', () => {
    it.each([
        ['product', () => productLink()],
        ['store', () => storeLink()],
        ['whatsapp', () => whatsappLink()],
    ])('opens the %s anchor in a new tab with all four rel tokens', (_label, getLink) => {
        show();

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

    it('keeps the full rel on the /go fallback anchors as well', () => {
        show({ product_url: null, store_url: null });

        for (const link of screen.getAllByRole('link')) {
            const rel = relTokens(link);
            expect(rel).toContain('noopener');
            expect(rel).toContain('noreferrer');
            expect(rel).toContain('nofollow');
            expect(rel).toContain('sponsored');
        }
    });
});

describe('AffiliateOfferCard — counting one tap exactly once', () => {
    it('agrees with the real service about which letter means what', async () => {
        const actual = await vi.importActual('../../services/affiliateService');

        // The mock above hard-codes p/s/w. If the real contract ever moved, every assertion in this
        // describe block would be checking a letter the backend does not count.
        expect(actual.AFFILIATE_LINK).toEqual({ PRODUCT: 'p', STORE: 's', WHATSAPP: 'w' });
    });

    it.each([
        ['product', () => productLink(), 'p'],
        ['store', () => storeLink(), 's'],
        ['whatsapp', () => whatsappLink(), 'w'],
    ])('beacons the %s tap once, with l=%s, and lets the navigation happen', (_label, getLink, letter) => {
        show();

        const notPrevented = clickAndKeepDefault(getLink());

        expect(countAffiliateClick).toHaveBeenCalledTimes(1);
        // Third argument is the surface the card was rendered on — a tap that cannot say where it
        // happened is a tap the per-placement stats table is specified to refuse.
        expect(countAffiliateClick).toHaveBeenCalledWith(OFFER.id, letter, 'area');
        // The visitor's trip is the point of the click; the statistic is our bookkeeping.
        expect(notPrevented).toBe(true);
    });

    it('does NOT beacon the product tap on the /go fallback — the 302 already counts it', () => {
        show({ product_url: null });

        clickAndKeepDefault(productLink());

        // Beaconing here too would file one tap as two on a number that goes on an invoice.
        expect(countAffiliateClick).not.toHaveBeenCalled();
    });

    it('does NOT beacon the store tap on the /go fallback either', () => {
        show({ store_url: null });

        clickAndKeepDefault(storeLink());

        // Asserted on the link letter alone, so this stays true whatever else a beacon carries.
        expect(countAffiliateClick.mock.calls.some((call) => call[1] === 's')).toBe(false);
    });

    it('always beacons WhatsApp — l=w has no redirect target at all', () => {
        // wa.me is a deep link the phone hands to another app; a redirector would break it, so the
        // beacon is the only thing that can count this tap.
        show({ product_url: null, store_url: null });

        clickAndKeepDefault(whatsappLink());

        expect(countAffiliateClick).toHaveBeenCalledTimes(1);
        expect(countAffiliateClick).toHaveBeenCalledWith(OFFER.id, 'w', 'area');
    });

    it('counts one tap per tap — two taps, two beacons, never a batch or a debounce', () => {
        show();

        clickAndKeepDefault(productLink());
        clickAndKeepDefault(productLink());

        expect(countAffiliateClick).toHaveBeenCalledTimes(2);
    });
});

describe('AffiliateOfferCard — copy and share send the shop URL, never /go', () => {
    const copyButton = () => screen.getByRole('button', { name: /Salin link/i });
    const shareButton = () => screen.getByRole('button', { name: /Bagikan/i });

    it('copies offer.product_url and confirms in-card', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubNavigator('clipboard', { writeText });
        show();

        await act(async () => {
            fireEvent.click(copyButton());
        });

        // A recipient sent an opaque /go path on a CCTV domain does not click it.
        expect(writeText).toHaveBeenCalledWith(OFFER.product_url);
        expect(writeText.mock.calls[0][0].startsWith(GO_PREFIX)).toBe(false);
        // In-card and transient — never an alert(), which would block the stream playing behind it.
        expect(await screen.findByText('Tersalin')).not.toBeNull();
    });

    it('says so quietly when the clipboard refuses, and does not paint a fault', async () => {
        stubNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) });
        const { container } = show();

        await act(async () => {
            fireEvent.click(copyButton());
        });

        expect(await screen.findByText('Gagal menyalin')).not.toBeNull();
        expect(container.innerHTML).not.toMatch(/status-fault/);
    });

    it('shares offer.product_url through the native sheet when the platform offers one', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubNavigator('share', share);
        stubNavigator('clipboard', { writeText });
        show();

        await act(async () => {
            fireEvent.click(shareButton());
        });

        expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: OFFER.product_url }));
        expect(writeText).not.toHaveBeenCalled();
    });

    it('does nothing when the visitor cancels the share sheet', async () => {
        const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubNavigator('share', vi.fn().mockRejectedValue(abort));
        stubNavigator('clipboard', { writeText });
        show();

        await act(async () => {
            fireEvent.click(shareButton());
        });

        // Cancelling is a decision, not a failure: do not "helpfully" copy something they declined.
        expect(writeText).not.toHaveBeenCalled();
        expect(screen.queryByText('Tersalin')).toBeNull();
    });

    it('falls back to copying when the share sheet is unusable', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubNavigator('share', vi.fn().mockRejectedValue(new Error('not allowed')));
        stubNavigator('clipboard', { writeText });
        show();

        await act(async () => {
            fireEvent.click(shareButton());
        });

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(OFFER.product_url));
    });

    it('hides both utilities when only the redirector exists — there is nothing worth sending', () => {
        show({ product_url: null });

        expect(screen.queryByRole('button', { name: /Salin link/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Bagikan/i })).toBeNull();
    });
});

describe('AffiliateOfferCard — the two "Bagikan" do not collide', () => {
    /*
     * The chip row above this card shares the CAMERA. This card shares the ITEM. Before the density
     * pass both said the single word "Bagikan", a few pixels apart, and nothing in the DOM said
     * which was which. The fix was to make this pair icon-only AND to name their object out loud —
     * which means the accessible name is now the ONLY carrier of that meaning, and is therefore
     * asserted verbatim rather than by pattern.
     */
    it('names the copy button "Salin link barang" exactly', () => {
        show();

        expect(screen.getByRole('button', { name: 'Salin link barang' })).not.toBeNull();
    });

    it('names the share button "Bagikan barang" exactly — never the bare verb', () => {
        show();

        expect(screen.getByRole('button', { name: 'Bagikan barang' })).not.toBeNull();
        // The camera's own control is the bare "Bagikan". If this card ever answers to that name
        // too, the two are ambiguous again for anyone not looking at the pixels.
        expect(screen.queryByRole('button', { name: 'Bagikan' })).toBeNull();
    });

    it.each([
        ['Salin link barang'],
        ['Bagikan barang'],
    ])('carries "%s" as a long-press title as well, not only for the screen reader', (name) => {
        show();

        expect(screen.getByRole('button', { name }).getAttribute('title')).toBe(name);
    });

    it('shows an icon and no visible text on either — the label lives in the accessible name now', () => {
        show();

        for (const name of ['Salin link barang', 'Bagikan barang']) {
            const button = screen.getByRole('button', { name });
            expect(button.textContent).toBe('');
            expect(button.querySelector('svg')).not.toBeNull();
            // Decorative: the button already has a name, so the icon must not repeat itself into it.
            expect(button.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
        }
    });

    it('still copies and still shares the product URL from the icon-only controls', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const share = vi.fn().mockResolvedValue(undefined);
        stubNavigator('clipboard', { writeText });
        stubNavigator('share', share);
        show();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Salin link barang' }));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Bagikan barang' }));
        });

        // Losing the visible label must not have quietly rewired what the buttons act on.
        expect(writeText).toHaveBeenCalledWith(OFFER.product_url);
        expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: OFFER.product_url }));
    });
});

describe('AffiliateOfferCard — one action row, and a CTA that does not shout', () => {
    it('puts the CTA, WhatsApp and both utilities in ONE row', () => {
        show();

        // Three stacked rows of chrome under a starting video was the bug being fixed. Asserting the
        // shared parent is what makes "one row" a fact instead of a screenshot.
        const row = productLink().parentElement;
        expect(row.contains(whatsappLink())).toBe(true);
        expect(row.contains(screen.getByRole('button', { name: 'Salin link barang' }))).toBe(true);
        expect(row.contains(screen.getByRole('button', { name: 'Bagikan barang' }))).toBe(true);
        expect(row.getAttribute('class')).toMatch(/flex-wrap/);
    });

    it('sizes the CTA to its content — primary, but never full-width under a live video', () => {
        show();

        const cls = productLink().getAttribute('class');
        // `w-full` is the whole regression: a full-width red-ish button directly under a starting
        // stream competes with the stream.
        expect(cls).not.toMatch(/\bw-full\b/);
        // Sized to content: it shares one row with WhatsApp and the two utilities.
        expect(cls).toMatch(/\binline-flex\b/);
        // It earns its primacy from padding and fill, never from taking the row.
        expect(cls).toMatch(/\bpx-4\b/);
        expect(cls).toMatch(/\bpy-2\b/);
        // Still visually primary (filled), and still not a fault colour.
        expect(cls).toMatch(/bg-primary/);
        expect(cls).not.toMatch(/status-fault/);
        // A keyboard user must be able to see where they are.
        expect(cls).toMatch(/focus-visible:outline-2/);
    });

    /*
     * The CTA sits directly beside the utilities that are 44px tall, so it must not be the only
     * control on the row that forgot a thumb exists.
     */
    it('keeps every control on the row a real touch target', () => {
        show();

        const row = productLink().parentElement;
        for (const control of row.querySelectorAll('a, button')) {
            const cls = control.getAttribute('class');
            const tall = /\bmin-h-\[(\d+)px\]/.exec(cls);
            const square = /\bh-11\b/.test(cls);
            expect(
                Boolean(tall) || square,
                `${control.getAttribute('aria-label')}: declares no minimum height`
            ).toBe(true);
            if (tall) {
                expect(Number(tall[1])).toBeGreaterThanOrEqual(40);
            }
        }
    });

    it('leaves the row holding only what is present when the optional controls are gone', () => {
        show({ whatsapp_url: null, product_url: null });

        // No WhatsApp number, and only the redirector to offer — so the row is the CTA alone. It
        // must not grow a placeholder to fill the space it used to share.
        const row = productLink().parentElement;
        expect(row.querySelectorAll('a, button')).toHaveLength(1);
    });
});

describe('AffiliateOfferCard — title and price share one line', () => {
    const title = () => screen.getByRole('heading', { level: 3 });

    it('lets the title yield space and never lets the price yield any', () => {
        show();

        // Two halves of one rule: without min-w-0 a flex child refuses to shrink below its content
        // and truncate never engages; without shrink-0 the price is what gets squeezed instead.
        expect(title().getAttribute('class')).toMatch(/min-w-0/);
        expect(title().getAttribute('class')).toMatch(/flex-1/);
        expect(title().getAttribute('class')).toMatch(/truncate/);

        const price = screen.getByTestId('affiliate-offer-price');
        expect(price.getAttribute('class')).toMatch(/shrink-0/);
        // A price is a number that changes between offers: it gets tabular figures.
        expect(price.getAttribute('class')).toMatch(/tabular-nums/);
    });

    it('really is ONE line — same flex parent, not two stacked blocks', () => {
        show();

        const row = title().parentElement;
        expect(row).toBe(screen.getByTestId('affiliate-offer-price').parentElement);
        expect(row.getAttribute('class')).toMatch(/\bflex\b/);
    });

    it('keeps the full title reachable although it truncates', () => {
        const longTitle = 'Kamera IP Outdoor 3MP PTZ Dual Lens 8x Zoom Warna Malam Hari Anti Air IP67';
        show({ product_title: longTitle });

        // Truncation is a visual clamp, so nothing may be LOST to it: long-press shows the title
        // attribute and the CTA's accessible name carries the whole string too.
        expect(title().getAttribute('title')).toBe(longTitle);
        expect(productLink().getAttribute('aria-label')).toBe(`Lihat barang: ${longTitle}`);
    });

    it('gives the price the whole line to itself when the title row is all there is', () => {
        show({ price_rupiah: 0 });

        expect(screen.getByTestId('affiliate-offer-price').parentElement).toBe(title().parentElement);
    });
});

describe('AffiliateOfferCard — the photo is a thumbnail, not a poster', () => {
    const photo = (container) => container.querySelector('img');

    it('reserves its exact box before the bytes land', () => {
        const { container } = show();

        const img = photo(container);
        // Intrinsic dimensions are what stop the card from jumping as the photo decodes — under a
        // video that is still starting, a shift here moves the controls out from under a thumb.
        expect(img.getAttribute('width')).toBe(String(OFFER.image_width));
        expect(img.getAttribute('height')).toBe(String(OFFER.image_height));
        expect(img.getAttribute('decoding')).toBe('async');
        expect(img.getAttribute('sizes')).toBe('(min-width: 640px) 80px, 64px');
    });

    it('lives in a FIXED square box, so a portrait upload cannot make the card phone-tall', () => {
        const { container } = show();

        const box = photo(container).parentElement;
        const cls = box.getAttribute('class');
        expect(cls).toMatch(/\bh-16\b/);
        expect(cls).toMatch(/\bw-16\b/);
        expect(cls).toMatch(/shrink-0/);
        // The box crops; the image fills it. Without overflow-hidden the crop does not happen.
        expect(cls).toMatch(/overflow-hidden/);
        expect(photo(container).getAttribute('class')).toMatch(/object-cover/);
    });

    it('still carries dimensions the browser can use when the operator uploaded a square', () => {
        const { container } = show({ image_width: 800, image_height: 800 });

        expect(photo(container).getAttribute('width')).toBe('800');
        expect(photo(container).getAttribute('height')).toBe('800');
    });
});

describe('AffiliateOfferCard — the shop link rides the disclosure row', () => {
    it('sits beside "Toko rekanan", because the disclosure and the shop are one thought', () => {
        show();

        const label = screen.getByText('Toko rekanan');
        expect(label.parentElement.contains(storeLink())).toBe(true);
        // And therefore NOT inside the action row, which is now exactly four controls wide.
        expect(productLink().parentElement.contains(storeLink())).toBe(false);
    });

    it('never lets a long shop name push the disclosure off its own line', () => {
        show({ store_name: 'Toko Sinar Elektronik Jaya Abadi Sentosa Bojonegoro' });

        // The label IS the disclosure: it always wins the space it needs, so the link is capped.
        const cls = storeLink().getAttribute('class');
        expect(cls).toMatch(/max-w-\[60%\]/);
        expect(cls).toMatch(/min-w-0/);
        expect(storeLink().querySelector('.truncate')).not.toBeNull();
    });

    it('leaves the disclosure standing on its own when there is no shop URL', () => {
        show(NO_STORE);

        expect(screen.getByText('Toko rekanan')).not.toBeNull();
        expect(screen.queryByRole('link', { name: /toko/i })).toBeNull();
    });
});

describe('AffiliateOfferCard — honesty, tokens and the mobile hard rules', () => {
    it('shows the "Toko rekanan" label — commercial content on a public surface says so', () => {
        show();

        expect(screen.getByText('Toko rekanan')).not.toBeNull();
    });

    it('renders the partner copy it was given', () => {
        show();

        expect(screen.getByText(OFFER.product_title)).not.toBeNull();
        expect(screen.getByText(OFFER.description)).not.toBeNull();
    });

    it('never paints itself as a fault — a shop link is not an error state', () => {
        const { container } = show();

        expect(container.innerHTML).not.toMatch(/status-fault/);
    });

    it('uses no raw greys or legacy ramps — semantic tokens only', () => {
        const { container } = show();

        expect(container.innerHTML).not.toMatch(/(^|[\s"'])(?:bg|text|border)-gray-\d/);
        expect(container.innerHTML).not.toMatch(/(^|[\s"'])(?:dark|light)-\d/);
    });

    it('keeps the mobile hard rules: no embeds, wrapping action rows, tappable truncating labels', () => {
        const { container } = show();

        // No iframe/embed on a public mobile surface — they walk straight through the root
        // overflow-x guard.
        expect(container.querySelector('iframe, embed, object')).toBeNull();
        // Nothing sized in viewport units and nothing position-fixed.
        expect(container.innerHTML).not.toMatch(/w-screen|100vw|\bfixed\b/);
        // The action row wraps: with Android font scaling at 1.3x a row of buttons is the classic
        // way a card grows wider than the viewport, so above 1x these wrap instead of widening.
        expect(container.querySelectorAll('.flex-wrap').length).toBeGreaterThanOrEqual(1);

        for (const link of screen.getAllByRole('link')) {
            const cls = link.getAttribute('class');
            expect(cls).toMatch(/min-h-\[40px\]/);
            expect(cls).toMatch(/min-w-0/);
            expect(link.querySelector('.truncate')).not.toBeNull();
        }
    });

    /*
     * 44px, not 40px, and not shrinking at `sm` either. An icon with no label is a SMALLER visual
     * target than a labelled control, so its hit area goes UP to compensate — the same rule the chip
     * row above this card follows for its five compact chips. The 4px mismatch against the labelled
     * controls beside them is deliberate: `items-center` centres it, and an honest tap target beats
     * a flush edge.
     */
    it('gives the two icon-only buttons a 44px thumb-sized square instead of a label to pad them', () => {
        show();

        for (const button of [
            screen.getByRole('button', { name: 'Salin link barang' }),
            screen.getByRole('button', { name: 'Bagikan barang' }),
        ]) {
            const cls = button.getAttribute('class');
            expect(cls).toMatch(/\bh-11\b/);
            expect(cls).toMatch(/\bw-11\b/);
            expect(cls).toMatch(/shrink-0/);
            // It does not get to shrink on a pointer device it may never meet.
            expect(cls, 'an unlabelled glyph does not shrink at sm').not.toMatch(/\bsm:h-\d/);
            // A keyboard user has no hover to fall back on, and no label to read either.
            expect(cls).toMatch(/focus-visible:outline-2/);
        }
    });

    it('keeps the photo inside its box', () => {
        const { container } = show();

        expect(container.querySelector('img').getAttribute('class')).toMatch(/max-w-full/);
    });

    it.each([
        ['no offer at all', undefined],
        ['a null offer', null],
        ['an offer with no title', { ...OFFER, product_title: '' }],
        ['an offer with neither a real URL nor a redirector', { ...OFFER, product_url: null, product_href: null }],
    ])('renders nothing for %s rather than an empty card', (_label, offer) => {
        const { container } = render(<AffiliateOfferCard offer={offer} />);

        expect(container.querySelector('[data-testid="affiliate-offer-card"]')).toBeNull();
        expect(container.textContent).toBe('');
    });

    it('wears the wrapper classes the host slot hands it', () => {
        const { container } = render(<AffiliateOfferCard offer={OFFER} className="border-t border-edge" />);

        expect(container.querySelector('[data-testid="affiliate-offer-card"]').getAttribute('class'))
            .toBe('border-t border-edge');
    });
});
