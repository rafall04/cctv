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

    it('keeps the mobile dock above footer-safe content and exposes favorite count in the label', () => {
        render(
            <LandingMobileDock
                viewMode="grid"
                onViewModeChange={vi.fn()}
                onHomeClick={vi.fn()}
                onQuickAccessClick={vi.fn()}
                quickAccessCount={3}
                favoriteCount={2}
            />
        );

        expect(screen.getByTestId('landing-mobile-dock').className).toContain('bottom-3');
        expect(screen.getByRole('button', { name: /Favorit 2/i })).toBeTruthy();
    });

    it('renders route links when item hrefs are provided', () => {
        render(
            <LandingMobileDock
                viewMode="playback"
                itemHrefs={{
                    home: '/',
                    map: '/?view=map&mode=full',
                    grid: '/?view=grid&mode=full',
                    quick: '/?view=grid&mode=full#public-quick-access',
                    playback: '/playback?cam=1-lobby&t=1777716000000',
                }}
            />
        );

        expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
        expect(screen.getByRole('link', { name: 'Map' }).getAttribute('href')).toBe('/?view=map&mode=full');
        expect(screen.getByRole('link', { name: 'Grid' }).getAttribute('href')).toBe('/?view=grid&mode=full');
        expect(screen.getByRole('link', { name: 'Favorit' }).getAttribute('href')).toBe('/?view=grid&mode=full#public-quick-access');
        expect(screen.getByRole('link', { name: 'Playback' }).getAttribute('href')).toBe('/playback?cam=1-lobby&t=1777716000000');
        expect(screen.getByRole('link', { name: 'Playback' }).className).toContain('bg-primary');
    });
});
