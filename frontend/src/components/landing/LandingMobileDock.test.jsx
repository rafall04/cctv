/*
 * Purpose: Verify mobile public dock navigates core landing workflows without desktop assumptions.
 * Caller: Frontend focused landing mobile dock test gate.
 * Deps: React Testing Library, Vitest, LandingMobileDock.
 * MainFuncs: Mobile dock click tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingMobileDock from './LandingMobileDock';

describe('LandingMobileDock', () => {
    it('changes map grid playback views and exposes quick access', () => {
        const onViewModeChange = vi.fn();
        const onHomeClick = vi.fn();
        const onQuickAccessClick = vi.fn();

        render(
            <LandingMobileDock
                viewMode="map"
                onViewModeChange={onViewModeChange}
                onHomeClick={onHomeClick}
                onQuickAccessClick={onQuickAccessClick}
                quickAccessCount={2}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
        fireEvent.click(screen.getByRole('button', { name: 'Playback' }));
        fireEvent.click(screen.getByRole('button', { name: 'Favorit' }));
        fireEvent.click(screen.getByRole('button', { name: 'Home' }));

        expect(onViewModeChange).toHaveBeenCalledWith('grid');
        expect(onViewModeChange).toHaveBeenCalledWith('playback');
        expect(onQuickAccessClick).toHaveBeenCalledTimes(1);
        expect(onHomeClick).toHaveBeenCalledTimes(1);
    });
});
