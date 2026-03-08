// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingAnnouncementBar from './LandingAnnouncementBar';

describe('LandingAnnouncementBar', () => {
    const announcement = {
        enabled: true,
        title: 'Info Layanan',
        text: 'Pemeliharaan malam ini.',
        style: 'warning',
        show_in_full: true,
        show_in_simple: false,
        isActive: true,
    };

    it('merender announcement aktif di mode yang diizinkan', () => {
        render(<LandingAnnouncementBar announcement={announcement} layoutMode="full" />);

        expect(screen.getByTestId('landing-announcement-full')).toBeTruthy();
        expect(screen.getByText('Info Layanan')).toBeTruthy();
        expect(screen.getByText('Pemeliharaan malam ini.')).toBeTruthy();
    });

    it('tidak merender announcement saat mode tidak diizinkan atau tidak aktif', () => {
        const { rerender } = render(<LandingAnnouncementBar announcement={announcement} layoutMode="simple" />);
        expect(screen.queryByTestId('landing-announcement-simple')).toBeNull();

        rerender(
            <LandingAnnouncementBar
                announcement={{ ...announcement, isActive: false, show_in_simple: true }}
                layoutMode="simple"
            />
        );
        expect(screen.queryByTestId('landing-announcement-simple')).toBeNull();
    });
});
