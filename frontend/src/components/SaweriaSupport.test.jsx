/*
 * Purpose: Verify Saweria floating banner stays in its own mobile lane away from feedback and bottom dock controls.
 * Caller: Frontend focused public floating widget test gate.
 * Deps: React Testing Library, Vitest, SaweriaSupport.
 * MainFuncs: Saweria floating position tests.
 * SideEffects: Mocks fetch, timers, localStorage, and window.open.
 */

import { act, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import SaweriaSupport from './SaweriaSupport';

describe('SaweriaSupport floating layout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        localStorage.setItem('saweria_dont_show', 'true');
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
});
