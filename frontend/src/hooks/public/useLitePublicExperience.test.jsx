// @vitest-environment jsdom

/*
 * Purpose: Verify the lite-experience hook resolves auto signals and reacts to the user preference toggle.
 * Caller: Frontend Vitest suite.
 * Deps: React, Testing Library, Vitest, useLitePublicExperience hook, setLitePreference util.
 * MainFuncs: useLitePublicExperience tests via a Probe component.
 * SideEffects: Clears localStorage in jsdom between tests.
 */

import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLitePublicExperience } from './useLitePublicExperience';
import { setLitePreference } from '../../utils/publicExperienceMode';

function Probe({ deviceTier }) {
    const lite = useLitePublicExperience({ deviceTier });
    return createElement('div', null, lite ? 'lite' : 'full');
}

describe('useLitePublicExperience', () => {
    beforeEach(() => {
        try {
            window.localStorage.clear();
        } catch {
            /* ignore */
        }
    });

    it('is full for a medium desktop and lite for a low tier (jsdom is not mobile)', () => {
        const { rerender } = render(createElement(Probe, { deviceTier: 'medium' }));
        expect(screen.getByText('full')).toBeTruthy();

        rerender(createElement(Probe, { deviceTier: 'low' }));
        expect(screen.getByText('lite')).toBeTruthy();
    });

    it('reacts live to the lite preference toggle', () => {
        render(createElement(Probe, { deviceTier: 'medium' }));
        expect(screen.getByText('full')).toBeTruthy();

        act(() => {
            setLitePreference(true);
        });
        expect(screen.getByText('lite')).toBeTruthy();

        act(() => {
            setLitePreference(false);
        });
        expect(screen.getByText('full')).toBeTruthy();

        act(() => {
            setLitePreference(null);
        });
        expect(screen.getByText('full')).toBeTruthy();
    });
});
