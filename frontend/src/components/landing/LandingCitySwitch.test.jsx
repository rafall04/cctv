/*
 * Purpose: Keep the city strip from widening the document and keep its chips thumb-sized.
 * Caller: Vitest focused public landing regression suite.
 * Deps: Testing Library, Vitest, LandingCitySwitch.
 * MainFuncs: LandingCitySwitch tests.
 * SideEffects: None.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingCitySwitch from './LandingCitySwitch';

const CITIES = [
    { key: 'sumedang', label: 'Sumedang', count: 120 },
    { key: 'bandung', label: 'Bandung', count: 95 },
    { key: 'garut', label: 'Garut', count: 40 },
];

function renderSwitch(props = {}) {
    render(
        <LandingCitySwitch
            selectedCity="all"
            onChange={vi.fn()}
            cityOptions={CITIES}
            totalCount={255}
            {...props}
        />
    );
    return screen.getByRole('button', { name: /Semua/ });
}

describe('LandingCitySwitch', () => {
    /*
     * The 2026-07 mobile incident: a horizontal strip without containment adds its overflow to the
     * document's scrollable rect, and in-app WebViews fit their initial zoom to that width — one
     * chip row shrinks the entire page. This was the last uncontained strip in the repo.
     */
    it('contains its own overflow instead of widening the document', () => {
        const strip = renderSwitch().parentElement;

        expect(strip.className).toMatch(/\boverflow-x-auto\b/);
        expect(strip.className, 'the containment is the whole point').toMatch(/\[contain:paint\]/);
        expect(strip.className, 'the strip must be allowed to shrink').toMatch(/\bmin-w-0\b/);
        expect(strip.className, 'and never exceed its parent').toMatch(/\bmax-w-full\b/);
    });

    it('gives every city chip a 40px thumb target on narrow screens', () => {
        renderSwitch();

        for (const name of ['Semua', 'Sumedang', 'Bandung', 'Garut']) {
            const cls = screen.getByRole('button', { name: new RegExp(name) }).className;
            expect(cls, `${name} chip is under the touch floor`).toMatch(/\bmin-h-\[40px\]/);
            expect(cls).toMatch(/\bsm:min-h-0\b/);
        }
    });

    it('says which city is selected without relying on colour', () => {
        renderSwitch({ selectedCity: 'bandung' });

        expect(screen.getByRole('button', { name: /Bandung/ }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: /Semua/ }).getAttribute('aria-pressed')).toBe('false');
    });

    it('renders nothing when the network only spans one city', () => {
        const { container } = render(
            <LandingCitySwitch selectedCity="all" onChange={vi.fn()} cityOptions={[CITIES[0]]} totalCount={120} />
        );

        expect(container.firstChild).toBeNull();
    });
});
