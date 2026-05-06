// @vitest-environment jsdom

/*
 * Purpose: Verify admin navigation readability and playback links inside the active admin shell.
 * Caller: Vitest frontend suite for admin layout regressions.
 * Deps: React Testing Library, TestRouter, mocked auth/theme/branding/notification contexts.
 * MainFuncs: AdminLayout dark mode readability tests.
 * SideEffects: Renders jsdom UI with mocked providers only.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    beforeEach(() => {
        localStorage.clear();
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockReturnValue({ matches: false }),
        });
    });

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

    it('menampilkan quick action admin mobile untuk PWA shell', () => {
        render(
            <TestRouter initialEntries={['/admin/dashboard']}>
                <AdminLayout>
                    <div>Content</div>
                </AdminLayout>
            </TestRouter>
        );

        const quickActions = within(screen.getByTestId('admin-pwa-quick-actions'));
        expect(quickActions.getByRole('link', { name: /Kamera/i }).getAttribute('href')).toBe('/admin/cameras');
        expect(quickActions.getByRole('link', { name: /Health/i }).getAttribute('href')).toBe('/admin/health-debug');
        expect(quickActions.getByRole('link', { name: /Token/i }).getAttribute('href')).toBe('/admin/playback-tokens');
        expect(quickActions.getByRole('link', { name: /Publik/i }).getAttribute('href')).toBe('/');
    });

    it('menampilkan prompt install admin app dengan dismissal key terpisah', async () => {
        render(
            <TestRouter initialEntries={['/admin/dashboard']}>
                <AdminLayout>
                    <div>Content</div>
                </AdminLayout>
            </TestRouter>
        );

        const event = new Event('beforeinstallprompt');
        event.preventDefault = vi.fn();
        event.prompt = vi.fn().mockResolvedValue(undefined);
        event.userChoice = Promise.resolve({ outcome: 'accepted' });

        await act(async () => {
            window.dispatchEvent(event);
            await Promise.resolve();
        });

        expect(screen.getByTestId('admin-pwa-install-banner')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Install Admin App/i }));
            await Promise.resolve();
        });

        expect(event.prompt).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('rafnet_admin_pwa_prompt_dismissed')).toBe('true');
    });
});
