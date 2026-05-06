// @vitest-environment jsdom

/*
 * Purpose: Validate public landing layout/view URL state and device-aware defaults.
 * Caller: Frontend focused public landing mode test gate.
 * Deps: React Testing Library, router test wrapper, useLandingModeState, mocked device detector.
 * MainFuncs: LandingModeStateHarness and useLandingModeState behavior tests.
 * SideEffects: Mutates jsdom localStorage and URL search params.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestRouter } from '../test/renderWithRouter';
import { useLandingModeState } from '../hooks/public/useLandingModeState';

const { isMobileDeviceMock, detectDeviceTierMock } = vi.hoisted(() => ({
    isMobileDeviceMock: vi.fn(() => false),
    detectDeviceTierMock: vi.fn(() => 'medium'),
}));

vi.mock('../utils/deviceDetector', () => ({
    isMobileDevice: isMobileDeviceMock,
    detectDeviceTier: detectDeviceTierMock,
}));

function LandingModeStateHarness() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { layoutMode, viewMode, setViewMode } = useLandingModeState(searchParams, setSearchParams);

    return (
        <div>
            <div data-testid="current-view">{viewMode}</div>
            <div data-testid="current-layout">{layoutMode}</div>
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
    beforeEach(() => {
        localStorage.clear();
        isMobileDeviceMock.mockReturnValue(false);
        detectDeviceTierMock.mockReturnValue('medium');
    });

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

    it('defaults mobile and low-end public landing to grid view when URL has no explicit view', () => {
        isMobileDeviceMock.mockReturnValue(true);
        detectDeviceTierMock.mockReturnValue('low');

        render(
            <TestRouter initialEntries={['/']}>
                <LandingModeStateHarness />
            </TestRouter>
        );

        expect(screen.getByTestId('current-view').textContent).toBe('grid');
        expect(screen.getByTestId('current-layout').textContent).toBe('simple');
        expect(screen.getByTestId('current-query').textContent).toContain('view=grid');
        expect(screen.getByTestId('current-query').textContent).toContain('mode=simple');
    });
});
