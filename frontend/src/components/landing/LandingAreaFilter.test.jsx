/*
 * Purpose: Pin the public area <select> to the mobile viewport rules it broke (16px on phones).
 * Caller: Vitest focused public landing regression suite.
 * Deps: Testing Library, Vitest, LandingAreaFilter.
 * MainFuncs: LandingAreaFilter tests.
 * SideEffects: None.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingAreaFilter from './LandingAreaFilter';

function renderFilter() {
    render(
        <LandingAreaFilter
            selectedArea="all"
            onChange={vi.fn()}
            areaOptions={['Pasar', 'Balai Desa']}
            searchFilteredCameras={[{ area_name: 'Pasar' }, { area_name: 'Balai Desa' }]}
        />
    );
    return screen.getByLabelText('Filter kamera berdasarkan area');
}

describe('LandingAreaFilter', () => {
    /*
     * Safari iOS zooms the page in whenever a focused select is under 16px, and this is the
     * second navigation facet on the public landing — a phone user meets it immediately.
     */
    it('keeps the select at 16px on phones and only shrinks it from sm', () => {
        const cls = renderFilter().className;

        expect(cls).toMatch(/\btext-base\b/);
        expect(cls).toMatch(/\bsm:text-sm\b/);
        expect(cls, 'a bare text-sm re-zooms the page on focus').not.toMatch(/(^|\s)text-sm\b/);
    });

    it('meets the 40px touch floor on narrow screens only', () => {
        const cls = renderFilter().className;

        expect(cls).toMatch(/\bmin-h-\[40px\]/);
        expect(cls, 'desktop density stays unchanged').toMatch(/\bsm:min-h-0\b/);
    });

    it('renders nothing when there is no area to filter by', () => {
        const { container } = render(
            <LandingAreaFilter selectedArea="all" onChange={vi.fn()} areaOptions={[]} searchFilteredCameras={[]} />
        );

        expect(container.firstChild).toBeNull();
    });
});
