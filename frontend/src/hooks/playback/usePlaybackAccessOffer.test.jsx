// @vitest-environment jsdom

/*
 * Purpose: Prove the catalogue lookup behind the "coba gratis atau beli akses" buttons — empty
 *          catalogue withdraws the offer, one request serves every caller, and a failure fails OPEN.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked playbackAccessService.
 * SideEffects: none.
 *
 * The fail-open case is the one worth guarding: hiding the only route to buying access because a
 * request blipped would cost real sales, and it is invisible in manual testing.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePlaybackAccessOffer, { resetPlaybackAccessOfferCache } from './usePlaybackAccessOffer';
import playbackAccessService from '../../services/playbackAccessService';

vi.mock('../../services/playbackAccessService', () => ({
    default: { getProducts: vi.fn() },
}));

function Probe() {
    const { ready, offered } = usePlaybackAccessOffer();
    return <span data-testid="state">{`${ready ? 'ready' : 'loading'}:${offered ? 'offered' : 'none'}`}</span>;
}

function PaidProbe() {
    const { ready, hasPaid } = usePlaybackAccessOffer();
    return <span data-testid="paid">{`${ready ? 'ready' : 'loading'}:${hasPaid ? 'paid' : 'trial-only'}`}</span>;
}

const products = (list) => ({ data: { products: list, trial: null } });

beforeEach(() => {
    resetPlaybackAccessOfferCache();
    playbackAccessService.getProducts.mockReset();
});

afterEach(() => {
    resetPlaybackAccessOfferCache();
});

describe('usePlaybackAccessOffer', () => {
    it('offers nothing before the answer arrives, so no promise is made then withdrawn', () => {
        playbackAccessService.getProducts.mockReturnValue(new Promise(() => {}));

        render(<Probe />);

        expect(screen.getByTestId('state').textContent).toBe('loading:none');
    });

    it('reports an offer when at least one package is enabled', async () => {
        playbackAccessService.getProducts.mockResolvedValue(products([{ key: 'daily', isTrial: false }]));

        render(<Probe />);

        await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready:offered'));
    });

    it('withdraws the offer when every package is disabled', async () => {
        playbackAccessService.getProducts.mockResolvedValue(products([]));

        render(<Probe />);

        await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready:none'));
    });

    /*
     * The catalogue being switched off returns a SUCCESSFUL empty list, so failing open here cannot
     * resurrect a disabled package — it only protects against a transient network error.
     */
    it('fails OPEN so a network blip never hides the way to buy access', async () => {
        playbackAccessService.getProducts.mockRejectedValue(new Error('network down'));

        render(<Probe />);

        await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready:offered'));
    });

    it('hasPaid is FALSE when only the free trial is enabled (copy must not promise "beli")', async () => {
        playbackAccessService.getProducts.mockResolvedValue(products([{ key: 'trial', isTrial: true }]));

        render(<PaidProbe />);

        await waitFor(() => expect(screen.getByTestId('paid').textContent).toBe('ready:trial-only'));
    });

    it('hasPaid is TRUE when a priced package is enabled', async () => {
        playbackAccessService.getProducts.mockResolvedValue(products([
            { key: 'trial', isTrial: true }, { key: 'weekly', isTrial: false },
        ]));

        render(<PaidProbe />);

        await waitFor(() => expect(screen.getByTestId('paid').textContent).toBe('ready:paid'));
    });

    it('hasPaid fails OPEN too, so a blip never hides the buy wording', async () => {
        playbackAccessService.getProducts.mockRejectedValue(new Error('network down'));

        render(<PaidProbe />);

        await waitFor(() => expect(screen.getByTestId('paid').textContent).toBe('ready:paid'));
    });

    it('answers every caller on the page from ONE request', async () => {
        playbackAccessService.getProducts.mockResolvedValue(products([]));

        render(<><Probe /><Probe /><Probe /></>);

        await waitFor(() => {
            expect(screen.getAllByTestId('state').map((n) => n.textContent)).toEqual([
                'ready:none', 'ready:none', 'ready:none',
            ]);
        });
        expect(playbackAccessService.getProducts).toHaveBeenCalledTimes(1);
    });
});
