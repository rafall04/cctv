// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { useSearchParams } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TestRouter } from '../test/renderWithRouter';
import { useLandingModeState } from '../hooks/public/useLandingModeState';

function LandingModeStateHarness() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { viewMode, setViewMode } = useLandingModeState(searchParams, setSearchParams);

    return (
        <div>
            <div data-testid="current-view">{viewMode}</div>
            <div data-testid="current-query">{searchParams.toString()}</div>
            <button type="button" onClick={() => setViewMode('grid')}>
                grid
            </button>
            <button type="button" onClick={() => setViewMode('playback')}>
                playback
            </button>
        </div>
    );
}

describe('useLandingModeState', () => {
    it('mengambil viewMode langsung dari URL dan memperbarui query saat mode berubah', () => {
        render(
            <TestRouter initialEntries={['/?mode=full&view=map&cam=test&t=123']}>
                <LandingModeStateHarness />
            </TestRouter>
        );

        expect(screen.getByTestId('current-view').textContent).toBe('map');

        fireEvent.click(screen.getByRole('button', { name: 'grid' }));

        expect(screen.getByTestId('current-view').textContent).toBe('grid');
        expect(screen.getByTestId('current-query').textContent).toContain('view=grid');
        expect(screen.getByTestId('current-query').textContent).not.toContain('cam=');
        expect(screen.getByTestId('current-query').textContent).not.toContain('t=');

        fireEvent.click(screen.getByRole('button', { name: 'playback' }));

        expect(screen.getByTestId('current-view').textContent).toBe('playback');
        expect(screen.getByTestId('current-query').textContent).toContain('view=playback');
    });
});
