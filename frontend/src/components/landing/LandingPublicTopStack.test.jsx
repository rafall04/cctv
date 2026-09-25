// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingPublicTopStack from './LandingPublicTopStack';

describe('LandingPublicTopStack', () => {
    it('merender nothing saat config publik masih loading (no layout shift)', () => {
        const { container } = render(<LandingPublicTopStack layoutMode="full" loading />);

        expect(container.firstChild).toBeNull();
        expect(screen.queryByTestId('landing-top-stack-shell-full')).toBeNull();
        expect(screen.queryByTestId('landing-event-banner-full')).toBeNull();
        expect(screen.queryByTestId('landing-announcement-full')).toBeNull();
    });
});
