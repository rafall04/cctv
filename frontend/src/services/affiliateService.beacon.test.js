/*
 * Purpose: Verify the counting beacon's URL — the one string that carries a surface name from the
 *          public page to the per-placement stats table.
 * Caller: frontend test gate.
 * Deps: vitest, mocked apiClient, affiliateService.
 * MainFuncs: buildAffiliateBeaconUrl / countAffiliateClick placement tests.
 * SideEffects: mocks the HTTP client and, in one test, `fetch`.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────────────────────
 * Both component test files mock affiliateService wholesale, so they can prove the card CALLS
 * countAffiliateClick with a surface and still say nothing about whether that surface reaches the
 * wire. Everything below the mock — the query string, and the validation that decides what is
 * allowed into it — had no coverage at all. That is the half that an invoice depends on.
 *
 * The parameter is spelled `placement`, matching the resolve endpoint and the backend's /go
 * handler. If that spelling ever diverges the counts silently blend back into one bucket, which is
 * the exact failure the placement split exists to end — so it is asserted as a literal here rather
 * than built from the same constant the implementation uses.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({
    default: { get: vi.fn() },
}));

import {
    AFFILIATE_PLACEMENTS,
    buildAffiliateBeaconUrl,
    countAffiliateClick,
} from './affiliateService';

describe('buildAffiliateBeaconUrl — the surface travels with the tap', () => {
    it.each(AFFILIATE_PLACEMENTS)('stamps placement=%s on the beacon', (placement) => {
        expect(buildAffiliateBeaconUrl(12, 'p', placement))
            .toBe(`/api/public/affiliate/offers/12/go?l=p&beacon=1&placement=${placement}`);
    });

    it('still counts the tap when the surface is missing or unknown, and says nothing false', () => {
        // The visitor's click is real whatever the caller forgot. Omitting the parameter lets the
        // backend's NOT NULL column refuse the write LOUDLY; substituting 'popup' would file the
        // tap under a surface it never happened on, which is worse than not counting it.
        for (const bad of [undefined, null, '', 'POPUP', 'homepage', 'popup ', 0]) {
            expect(buildAffiliateBeaconUrl(12, 'p', bad))
                .toBe('/api/public/affiliate/offers/12/go?l=p&beacon=1');
        }
    });

    it('refuses an id or a link it will not send, placement or not', () => {
        expect(buildAffiliateBeaconUrl(0, 'p', 'area')).toBeNull();
        expect(buildAffiliateBeaconUrl('abc', 'p', 'area')).toBeNull();
        expect(buildAffiliateBeaconUrl(12, 'x', 'area')).toBeNull();
    });

    it('mirrors the backend list exactly — a surface only the frontend believes in counts nowhere', () => {
        expect([...AFFILIATE_PLACEMENTS]).toEqual(['popup', 'area', 'landing', 'playback']);
    });
});

describe('countAffiliateClick — what actually reaches the network', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it('requests the beaconed URL, surface included, without blocking the navigation', () => {
        const fetchMock = vi.fn(() => Promise.resolve());
        vi.stubGlobal('fetch', fetchMock);

        expect(countAffiliateClick(12, 'w', 'landing')).toBe(true);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/public/affiliate/offers/12/go?l=w&beacon=1&placement=landing');
        // keepalive is what lets the count survive the page going away; GET is the method the
        // route actually serves (sendBeacon can only POST, which would 404 invisibly).
        expect(options).toMatchObject({ method: 'GET', keepalive: true, credentials: 'omit' });
    });

    it('sends nothing at all when there is nothing valid to count', () => {
        const fetchMock = vi.fn(() => Promise.resolve());
        vi.stubGlobal('fetch', fetchMock);

        expect(countAffiliateClick(12, 'x', 'area')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
