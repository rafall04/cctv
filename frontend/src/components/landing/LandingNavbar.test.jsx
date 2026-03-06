// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingNavbar from './LandingNavbar';

vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({
        isDark: false,
        toggleTheme: vi.fn(),
    }),
}));

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({
        cameras: [{ id: 1 }],
    }),
}));

vi.mock('../../utils/animationControl', () => ({
    shouldDisableAnimations: () => true,
}));

const branding = {
    company_name: 'RAF NET',
    company_tagline: 'Internet & CCTV',
    city_name: 'Pekalongan',
    logo_text: 'R',
};

describe('LandingNavbar', () => {
    it('menampilkan toggle layout berbasis teks dan menghapus label publik', () => {
        const onLayoutToggle = vi.fn();

        render(
            <LandingNavbar
                branding={branding}
                layoutMode="full"
                onLayoutToggle={onLayoutToggle}
            />
        );

        expect(screen.getByRole('tab', { name: /full/i })).not.toBeNull();
        expect(screen.getByRole('tab', { name: /simple/i })).not.toBeNull();
        expect(screen.queryByText('Publik')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: /simple/i }));
        expect(onLayoutToggle).toHaveBeenCalledTimes(1);
    });
});
