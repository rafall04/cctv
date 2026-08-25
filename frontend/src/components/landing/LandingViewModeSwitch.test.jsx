/*
 * Purpose: Keep the public view-mode switch thumb-sized, shrinkable, and audible to a screen reader.
 * Caller: Vitest focused public landing regression suite.
 * Deps: Testing Library, Vitest, LandingViewModeSwitch.
 * MainFuncs: LandingViewModeSwitch tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingViewModeSwitch from './LandingViewModeSwitch';

const MODES = ['Peta', 'Grid', 'Playback'];

describe('LandingViewModeSwitch', () => {
    it('meets the 40px touch floor on narrow screens only', () => {
        render(<LandingViewModeSwitch viewMode="map" onChange={vi.fn()} />);

        for (const name of MODES) {
            const cls = screen.getByRole('button', { name }).className;
            expect(cls, `${name} was 36px tall`).toMatch(/\bmin-h-\[40px\]/);
            expect(cls).toMatch(/\bsm:min-h-0\b/);
        }
    });

    /* Which mode is open was carried by background colour alone. aria-pressed is the toggle-group
     * equivalent of the dock's aria-current — same defect, same fix, different control role. */
    it('announces the open mode instead of only colouring it', () => {
        render(<LandingViewModeSwitch viewMode="grid" onChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Grid' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Peta' }).getAttribute('aria-pressed')).toBe('false');
    });

    /* The row that could scroll the page sideways at Android's 1.3x font scale: it must stay
     * shrinkable, and its labels must have somewhere to go. */
    it('stays shrinkable so a larger font scale cannot widen the page', () => {
        render(<LandingViewModeSwitch viewMode="map" onChange={vi.fn()} />);

        const button = screen.getByRole('button', { name: 'Playback' });
        expect(button.className).toMatch(/\bmin-w-0\b/);
        expect(button.parentElement.className).toMatch(/\bmax-w-full\b/);
        expect(screen.getByText('Playback').className).toMatch(/\btruncate\b/);
    });

    it('changes mode on click', () => {
        const onChange = vi.fn();
        render(<LandingViewModeSwitch viewMode="map" onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'Playback' }));
        expect(onChange).toHaveBeenCalledWith('playback');
    });
});
