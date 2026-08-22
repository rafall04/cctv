/**
 * Purpose: Prove the WIRING between an affiliate request and a per-surface count — that the
 *          placement the resolve endpoint was asked for is the placement the impression is written
 *          under, that /go carries its own surface, that the per-IP throttle collapses a repeat of
 *          the SAME event on the SAME surface and nothing more, and that a bad surface tag never
 *          costs a visitor their redirect.
 * Caller: Backend test gate (vitest, node env).
 * Deps: vitest; the REAL utils/affiliateCountThrottle and the REAL placementFromGoQuery rule;
 *       affiliateOfferService, promoImageService, rateLimiter and securityAuditLogger are mocked.
 * SideEffects: None. connectionPool is mocked, so no database is opened, read or written.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM affiliateOfferService.test.js
 * ------------------------------------------------------------------
 * That file proves the STATEMENT is right: the widened unique key, the guard, the rollup. None of
 * it can notice a handler that validates a placement beautifully and then calls the counter without
 * it — which is the entire failure mode this change introduces, and the one a survey of the service
 * would call "done". The interesting behaviour here lives between the query string and the service
 * call, so the service is a spy and the assertions are about the ARGUMENTS it was handed.
 *
 * WHY THE THROTTLE IS THE REAL ONE
 * --------------------------------
 * The throttle key was the sharpest edge in this change. It collapses one identity + one event into
 * a single count per 10-second window, and a visitor going landing -> area -> camera does exactly
 * that in well under ten seconds. Keyed on the offer alone — as it was — the second and third
 * surfaces would be swallowed, and the breakdown would be wrong for the fastest-moving visitors
 * while every unit test still passed. A mocked allowCount() would have reproduced the bug and
 * reported green, so this file uses the real one and asserts on both directions: a repeat of the
 * same surface is collapsed, a different surface is not.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
    resolveOfferForContext: vi.fn(),
    resolveOfferForRedirect: vi.fn(),
    recordImpression: vi.fn(),
    recordClick: vi.fn(),
}));

/*
 * The controller imports the offer service for data and `placementFromGoQuery` for the /go rule.
 * The data half is a spy; the RULE is the real implementation, imported from the module that owns
 * it — a stubbed rule would let this file agree with itself about what 'popup' means.
 */
vi.mock('../services/affiliateOfferService.js', async () => {
    const stats = await vi.importActual('../services/affiliateStatsService.js');
    return { default: service, placementFromGoQuery: stats.placementFromGoQuery };
});

// Nothing here touches a row; mocking the pool keeps the file from opening backend/data/cctv.db.
vi.mock('../database/connectionPool.js', () => ({
    query: vi.fn(() => []),
    queryOne: vi.fn(() => null),
    execute: vi.fn(),
    transaction: vi.fn((callback) => callback),
}));

vi.mock('../middleware/rateLimiter.js', () => ({ resolveClientIp: () => '203.0.113.7' }));
vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: vi.fn() }));
vi.mock('../services/promoImageService.js', () => ({
    savePromoImage: vi.fn(),
    MAX_AFFILIATE_UPLOAD_BYTES: 5 * 1024 * 1024,
    AFFILIATE_IMAGE_OPTIONS: {},
}));

import { getPublicAffiliateOffer, goAffiliateOffer } from '../controllers/affiliateController.js';
import { _resetThrottleForTests } from '../utils/affiliateCountThrottle.js';

/** A real browser navigation from our own site: passes both counting gates. */
const REAL_TAP = {
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
};

function makeRequest({ query = {}, params = {}, headers = REAL_TAP } = {}) {
    return { query, params, headers };
}

function makeReply() {
    return {
        statusCode: null,
        payload: undefined,
        headers: {},
        redirectedTo: null,
        header(key, value) { this.headers[key] = value; return this; },
        code(status) { this.statusCode = status; return this; },
        send(payload) { this.payload = payload; return this; },
        redirect(url, status) { this.redirectedTo = url; this.statusCode = status; return this; },
    };
}

const OFFER = { id: 12, product_title: 'Kamera Indoor 2MP' };

beforeEach(() => {
    _resetThrottleForTests();
    vi.clearAllMocks();
    service.resolveOfferForContext.mockReturnValue(OFFER);
    service.resolveOfferForRedirect.mockReturnValue({ url: 'https://toko-sinar.example/produk' });
});

describe('resolve endpoint -> impression write', () => {
    it('writes the impression under the surface that asked for the offer', async () => {
        await getPublicAffiliateOffer(makeRequest({ query: { placement: 'landing' } }), makeReply());

        expect(service.resolveOfferForContext).toHaveBeenCalledWith(
            expect.objectContaining({ placement: 'landing' })
        );
        expect(service.recordImpression).toHaveBeenCalledWith(OFFER.id, 'landing');
    });

    it('counts the same offer once per surface for one visitor, not once in total', async () => {
        /*
         * The reason the throttle key had to grow. Landing -> area -> camera inside ten seconds is
         * an ordinary browsing session, and it is THREE impressions on three surfaces. Keyed on the
         * offer alone, the last two are swallowed and the breakdown under-reports exactly the
         * surfaces this change was made to measure.
         */
        for (const placement of ['landing', 'area', 'popup']) {
            await getPublicAffiliateOffer(makeRequest({ query: { placement } }), makeReply());
        }

        expect(service.recordImpression.mock.calls).toEqual([
            [OFFER.id, 'landing'],
            [OFFER.id, 'area'],
            [OFFER.id, 'popup'],
        ]);
    });

    it('still collapses a repeat of the SAME surface (the throttle keeps doing its job)', async () => {
        // apiClient replays a failed GET twice, so one rendered card can produce three resolves.
        for (let i = 0; i < 3; i += 1) {
            await getPublicAffiliateOffer(makeRequest({ query: { placement: 'area' } }), makeReply());
        }

        expect(service.recordImpression).toHaveBeenCalledTimes(1);
        expect(service.recordImpression).toHaveBeenCalledWith(OFFER.id, 'area');
    });

    it('writes nothing when no offer resolved (there was nothing to be impressed by)', async () => {
        service.resolveOfferForContext.mockReturnValue(null);

        const reply = makeReply();
        await getPublicAffiliateOffer(makeRequest({ query: { placement: 'playback' } }), reply);

        expect(service.recordImpression).not.toHaveBeenCalled();
        expect(reply.payload).toEqual({ success: true, data: null });
    });
});

describe('/go endpoint -> click write', () => {
    it('carries the surface from the query string into the click write', async () => {
        const reply = makeReply();
        await goAffiliateOffer(
            makeRequest({ params: { id: '12' }, query: { l: 'p', placement: 'area', beacon: '1' } }),
            reply
        );

        expect(service.recordClick).toHaveBeenCalledWith(12, 'p', 'area');
        expect(reply.statusCode).toBe(204);
    });

    it('files a link with no placement under popup — the pre-change links, not new callers', async () => {
        await goAffiliateOffer(
            makeRequest({ params: { id: '12' }, query: { l: 's', beacon: '1' } }),
            makeReply()
        );

        expect(service.recordClick).toHaveBeenCalledWith(12, 's', 'popup');
    });

    it('counts a tap on each surface separately, one throttle window notwithstanding', async () => {
        for (const placement of ['popup', 'playback']) {
            await goAffiliateOffer(
                makeRequest({ params: { id: '12' }, query: { l: 'p', placement, beacon: '1' } }),
                makeReply()
            );
        }

        expect(service.recordClick.mock.calls).toEqual([
            [12, 'p', 'popup'],
            [12, 'p', 'playback'],
        ]);
    });

    it('redirects the visitor even when the surface tag is nonsense, and counts nothing for it', async () => {
        /*
         * A counter is never allowed to cost someone their destination — the rule the whole
         * best-effort counting path is built on. So an unrecognised surface hands the service null
         * (which it refuses, silently, throttled) and the 302 goes out regardless.
         */
        const reply = makeReply();
        await goAffiliateOffer(
            makeRequest({ params: { id: '12' }, query: { l: 'p', placement: 'under-video' } }),
            reply
        );

        expect(service.recordClick).toHaveBeenCalledWith(12, 'p', null);
        expect(reply.redirectedTo).toBe('https://toko-sinar.example/produk');
        expect(reply.statusCode).toBe(302);
    });

    it('does not count a cross-site beacon, whatever surface it claims', async () => {
        const reply = makeReply();
        await goAffiliateOffer(
            makeRequest({
                params: { id: '12' },
                query: { l: 'p', placement: 'landing', beacon: '1' },
                headers: { 'sec-fetch-site': 'cross-site' },
            }),
            reply
        );

        expect(service.recordClick).not.toHaveBeenCalled();
        expect(reply.statusCode).toBe(204);
    });
});
