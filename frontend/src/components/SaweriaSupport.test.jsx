/*
 * Purpose: Verify Saweria floating banner stays in its own mobile lane away from feedback and bottom dock controls.
 * Caller: Frontend focused public floating widget test gate.
 * Deps: React Testing Library, Vitest, SaweriaSupport.
 * MainFuncs: Saweria floating position tests.
 * SideEffects: Mocks fetch, timers, localStorage, and window.open.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import SaweriaSupport from './SaweriaSupport';

describe('SaweriaSupport floating layout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        // Deliberately NOT setting `saweria_dont_show`. It used to be the shortcut into the
        // banner branch (the other branch auto-opened the modal); the banner is now the only
        // path, and that key means "suppress the ask entirely", which would hide the banner.
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: { enabled: true } }),
        });
        vi.spyOn(window, 'open').mockImplementation(() => null);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** Advance to the moment the banner has just appeared, still open. */
    const renderAndPeek = async () => {
        render(<SaweriaSupport />);
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            vi.advanceTimersByTime(3000);
            await Promise.resolve();
        });
    };

    /*
     * "Peek, then settle" is the whole reason the ask can be visible early without being
     * intrusive: it arrives OPEN so the visitor actually sees it, then folds itself away so
     * ignoring it costs nothing. Both halves are load-bearing — a banner that never opens is
     * invisible, one that never folds is the nagging corner ad it replaced.
     */
    it('arrives open, then folds itself into the bubble when ignored', async () => {
        await renderAndPeek();

        // Open: the full ask is readable.
        expect(screen.getByText('Dukung Kami')).toBeTruthy();
        expect(screen.getByText('Traktir Kopi')).toBeTruthy();

        await act(async () => {
            vi.advanceTimersByTime(9000);
            await Promise.resolve();
        });

        // Settled: the card is gone, the bubble remains — nothing was dismissed by the user.
        expect(screen.queryByText('Dukung Kami')).toBeNull();
        expect(screen.getByTestId('saweria-floating-banner').className).toContain('w-14');
    });

    it('stays open when the visitor is actually touching it', async () => {
        await renderAndPeek();
        const banner = screen.getByTestId('saweria-floating-banner');

        fireEvent.mouseEnter(banner);
        await act(async () => {
            vi.advanceTimersByTime(9000);
            await Promise.resolve();
        });

        expect(screen.getByText('Dukung Kami')).toBeTruthy();
    });

    it('places the banner on the left on mobile and keeps desktop right-side stacking', async () => {
        render(<SaweriaSupport />);

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        await act(async () => {
            vi.advanceTimersByTime(3000);
            await Promise.resolve();
        });

        const banner = screen.getByTestId('saweria-floating-banner');
        expect(banner.className).toContain('left-4');
        expect(banner.className).toContain('sm:right-6');
        expect(banner.className).toContain('sm:left-auto');
        expect(banner.className).toContain('max-w-52');
        // The banner is bounded by a right inset on mobile instead of the old
        // `w-[calc(100vw-7rem)]`. A fixed element is not clipped by the root
        // overflow guard, so sizing one with a viewport unit can widen the whole
        // page; insets can only ever resolve to viewport-minus-margins.
        expect(banner.className).toContain('right-[6.5rem]');
        expect(banner.className).not.toContain('100vw');
    });

    /*
     * The donation modal used to open itself over the page — on scroll past 100px, or after
     * an 8s fallback for visitors who never scrolled. On a public CCTV page that is an
     * interstitial nobody asked for, and on a phone it covered the whole viewport.
     */
    it('never opens the modal on its own — not on scroll, not on a timer', async () => {
        render(<SaweriaSupport />);

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        await act(async () => {
            window.scrollY = 400;
            window.dispatchEvent(new Event('scroll'));
            // Well past both old triggers: the 1.5s post-scroll delay and the 8s fallback.
            vi.advanceTimersByTime(20000);
            await Promise.resolve();
        });

        expect(screen.queryByText('Traktir Kopi Dong!')).toBeNull();
        expect(screen.getByTestId('saweria-floating-banner')).toBeTruthy();
    });
});
