// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AdminLayout from './AdminLayout';

vi.mock('../services/authService', () => ({
    authService: {
        getCurrentUser: () => ({ id: 1, username: 'admin' }),
        logout: vi.fn(),
    },
}));

vi.mock('../contexts/ThemeContext', () => ({
    useTheme: () => ({
        isDark: true,
        toggleTheme: vi.fn(),
    }),
}));

vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success: vi.fn(),
    }),
}));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({
        branding: {
            company_name: 'RAF NET CCTV',
        },
    }),
}));

vi.mock('../components/ui/NetworkStatusBanner', () => ({
    NetworkStatusBanner: () => null,
}));

describe('AdminLayout dark mode readability', () => {
    it('memberi tone dark mode eksplisit pada heading navigasi dan quick links', () => {
        render(
            <MemoryRouter initialEntries={['/admin/dashboard']}>
                <AdminLayout>
                    <div>Content</div>
                </AdminLayout>
            </MemoryRouter>
        );

        expect(screen.getByText('Main Menu').className).toContain('dark:text-gray-400');
        expect(screen.getByText('Quick Links').className).toContain('dark:text-gray-400');
        expect(screen.getByText('Light Mode').closest('button').className).toContain('dark:text-gray-300');
    });

    it('menampilkan tautan playback admin di navigasi utama', () => {
        render(
            <MemoryRouter initialEntries={['/admin/dashboard']}>
                <AdminLayout>
                    <div>Content</div>
                </AdminLayout>
            </MemoryRouter>
        );

        const playbackLink = screen.getByRole('link', { name: /Playback/i });
        expect(playbackLink.getAttribute('href')).toBe('/admin/playback');
    });
});
