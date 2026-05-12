/*
 * Purpose: Verify public landing camera filter search index keeps large lists cheap and stable.
 * Caller: Frontend focused landing filter test gate.
 * Deps: Vitest, useLandingCameraFilters pure helpers.
 * MainFuncs: buildLandingCameraSearchIndex tests.
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
        createElement(
            'output',
            { 'data-testid': 'filtered-ids' },
            filters.filteredForGrid.map((camera) => camera.id).join(',')
        ),
        createElement(
            'output',
            { 'data-testid': 'favorite-count' },
            filters.favoritesInAreaCount
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
});
