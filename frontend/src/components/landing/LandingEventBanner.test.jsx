// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingEventBanner from './LandingEventBanner';

describe('LandingEventBanner', () => {
    const banner = {
        enabled: true,
        title: 'Ramadan Kareem',
        text: 'Selamat menunaikan ibadah puasa.',
        theme: 'ramadan',
        show_in_full: true,
        show_in_simple: true,
        isActive: true,
    };

    it('merender event banner aktif pada full mode', () => {
        render(<LandingEventBanner banner={banner} layoutMode="full" />);

        expect(screen.getByTestId('landing-event-banner-full')).toBeTruthy();
        expect(screen.getByText('Ramadan Kareem')).toBeTruthy();
        expect(screen.getByText('Selamat menunaikan ibadah puasa.')).toBeTruthy();
    });

    it('tidak merender jika banner tidak aktif', () => {
        render(
            <LandingEventBanner
                banner={{ ...banner, isActive: false }}
                layoutMode="simple"
            />
        );

        expect(screen.queryByTestId('landing-event-banner-simple')).toBeNull();
    });
});
