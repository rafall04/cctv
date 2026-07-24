/*
 * Purpose: Verify public landing camera filter search index keeps large lists cheap and stable,
 *          and that the city (kota) facet scopes results and rolls sub-areas up.
 * Caller: Frontend focused landing filter test gate.
 * Deps: Vitest, useLandingCameraFilters pure helpers.
 * MainFuncs: buildLandingCameraSearchIndex tests, city facet tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildLandingCameraSearchIndex, normalizeSearchText, useLandingCameraFilters } from './useLandingCameraFilters';

function FilterProbe({ cameras, favorites }) {
    const filters = useLandingCameraFilters(cameras, [], favorites, 'grid', vi.fn());

    return createElement(
        'div',
        null,
        createElement(
            'button',
            {
                type: 'button',
                onClick: () => filters.setConnectionTab('favorites'),
            },
            'favorites'
        ),
        filters.cityOptions.map((city) => createElement(
            'button',
            {
                key: city.key,
                type: 'button',
                onClick: () => filters.handleCityChange(city.key),
            },
            `city-${city.key}`
        )),
        createElement(
            'output',
            { 'data-testid': 'filtered-ids' },
            filters.filteredForGrid.map((camera) => camera.id).join(',')
        ),
        createElement(
            'output',
            { 'data-testid': 'favorite-count' },
            filters.favoritesInAreaCount
        ),
        createElement(
            'output',
            { 'data-testid': 'selected-city' },
            filters.selectedCity
        ),
        createElement(
            'output',
            { 'data-testid': 'city-options' },
            filters.cityOptions.map((city) => `${city.key}:${city.count}`).join(',')
        )
    );
}

describe('landing camera filter search index', () => {
    it('normalizes search text once for camera name, location, and area fields', () => {
        const indexed = buildLandingCameraSearchIndex([
            {
                id: 1,
                name: 'CCTV Gerbang Utara',
                location: 'Jalan Raya',
                area_name: 'KAB SURABAYA',
            },
        ]);

        expect(indexed).toHaveLength(1);
        expect(indexed[0].camera.id).toBe(1);
        expect(indexed[0].searchText).toContain('cctv gerbang utara');
        expect(indexed[0].searchText).toContain('jalan raya');
        expect(indexed[0].searchText).toContain('kab surabaya');
    });

    it('folds diacritics so public search works across mobile keyboard variants', () => {
        expect(normalizeSearchText('Café MÁLAM')).toBe('cafe malam');
    });
    it('keeps favorite filtering order stable', () => {
        render(createElement(FilterProbe, {
            cameras: [
                { id: 1, name: 'Alpha', area_name: 'A' },
                { id: 2, name: 'Bravo', area_name: 'A' },
                { id: 3, name: 'Charlie', area_name: 'A' },
                { id: 4, name: 'Delta', area_name: 'A' },
            ],
            favorites: [2, 4],
        }));

        fireEvent.click(screen.getByRole('button', { name: 'favorites' }));

        expect(screen.getByTestId('filtered-ids').textContent).toBe('2,4');
        expect(screen.getByTestId('favorite-count').textContent).toBe('2');
    });

    it('scopes cameras to the selected city and rolls village sub-areas up', () => {
        render(createElement(FilterProbe, {
            cameras: [
                { id: 1, name: 'Sby A', area_name: 'KAB SURABAYA' },
                { id: 2, name: 'Sby B', area_name: 'KAB SURABAYA' },
                { id: 3, name: 'Dander', area_name: 'DS DANDER' },
                { id: 4, name: 'Tanjung', area_name: 'DS TANJUNGHARJO' },
            ],
            favorites: [],
        }));

        // Dander + Tanjungharjo roll up to one Bojonegoro city; equal counts sort by label.
        expect(screen.getByTestId('city-options').textContent).toBe('bojonegoro:2,surabaya:2');

        fireEvent.click(screen.getByRole('button', { name: 'city-bojonegoro' }));

        expect(screen.getByTestId('selected-city').textContent).toBe('bojonegoro');
        expect(screen.getByTestId('filtered-ids').textContent).toBe('3,4');
    });
});
