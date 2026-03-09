// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingPublicTopStack from './LandingPublicTopStack';

describe('LandingPublicTopStack', () => {
    it('merender shell placeholder saat config publik masih loading', () => {
        render(<LandingPublicTopStack layoutMode="full" loading />);

        expect(screen.getByTestId('landing-top-stack-shell-full')).toBeTruthy();
        expect(screen.queryByTestId('landing-event-banner-full')).toBeNull();
        expect(screen.queryByTestId('landing-announcement-full')).toBeNull();
    });
});
