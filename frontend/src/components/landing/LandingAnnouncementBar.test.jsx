// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', class {
            observe() {}
            disconnect() {}
        });
        vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })));
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get() {
                return 120;
            },
        });
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
            configurable: true,
            get() {
                return this.textContent?.includes('Pemeliharaan') ? 420 : 80;
            },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('merender announcement aktif di mode yang diizinkan', () => {
        render(<LandingAnnouncementBar announcement={announcement} layoutMode="full" />);

        expect(screen.getByTestId('landing-announcement-full')).toBeTruthy();
        expect(screen.getByText('Info Layanan')).toBeTruthy();
        expect(screen.getAllByText('Pemeliharaan malam ini.').length).toBeGreaterThan(0);
    });

    it('mengaktifkan ticker saat teks melebihi container', async () => {
        render(<LandingAnnouncementBar announcement={announcement} layoutMode="full" />);

        await waitFor(() => {
            expect(screen.getByTestId('landing-announcement-ticker-full')).toBeTruthy();
        });

        expect(
            screen.queryByTestId('landing-announcement-fade-left-full')
        ).toBeNull();
        expect(
            screen.queryByTestId('landing-announcement-fade-right-full')
        ).toBeNull();
    });

    it('fallback ke teks statis saat reduced motion aktif', async () => {
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));

        render(<LandingAnnouncementBar announcement={announcement} layoutMode="full" />);

        await waitFor(() => {
            expect(screen.getByTestId('landing-announcement-static-full')).toBeTruthy();
        });
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
