// @vitest-environment jsdom

/*
 * Purpose: Verify admin navigation readability and playback links inside the active admin shell.
 * Caller: Vitest frontend suite for admin layout regressions.
 * Deps: React Testing Library, TestRouter, mocked auth/theme/branding/notification contexts.
 * MainFuncs: AdminLayout dark mode readability tests.
 * SideEffects: Renders jsdom UI with mocked providers only.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminLayout from './AdminLayout';
import { TestRouter } from '../test/renderWithRouter';

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
            <TestRouter initialEntries={['/admin/dashboard']}>
                <AdminLayout>
                    <div>Content</div>
                </AdminLayout>
            </TestRouter>
        );

        expect(screen.getByText('Main Menu').className).toContain('dark:text-gray-400');
        expect(screen.getByText('Quick Links').className).toContain('dark:text-gray-400');
        expect(screen.getByText('Light Mode').closest('button').className).toContain('dark:text-gray-300');
    });

    it('menampilkan tautan playback admin di navigasi utama', () => {
        render(
            <TestRouter initialEntries={['/admin/dashboard']}>
                <AdminLayout>
                    <div>Content</div>
                </AdminLayout>
            </TestRouter>
        );

        const playbackLink = screen.getByRole('link', { name: /^Playback$/i });
        expect(playbackLink.getAttribute('href')).toBe('/admin/playback');
    });

    it('menampilkan tautan playback analytics di navigasi utama', () => {
        render(
            <TestRouter initialEntries={['/admin/dashboard']}>
                <AdminLayout>
                    <div>Content</div>
                </AdminLayout>
            </TestRouter>
        );

        const playbackAnalyticsLink = screen.getByRole('link', { name: /^Playback Analytics$/i });
        expect(playbackAnalyticsLink.getAttribute('href')).toBe('/admin/playback-analytics');
    });
});
