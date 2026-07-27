// @vitest-environment jsdom

/*
 * Purpose: Verify the admin shell's navigation model — grouping, search, active-page semantics,
 *   role filtering, token-based theming, and the mobile dock.
 * Caller: Vitest frontend suite for admin layout regressions.
 * Deps: React Testing Library, TestRouter, mocked auth/theme/branding/notification contexts.
 * MainFuncs: AdminLayout navigation assertions.
 * SideEffects: Renders jsdom UI with mocked providers only.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLayout from './AdminLayout';
import { NAV_GROUPS, filterNavGroups } from './adminNavigation';
import { TestRouter } from '../test/renderWithRouter';

let currentUser = { id: 1, username: 'admin', role: 'admin' };

vi.mock('../services/authService', () => ({
    authService: {
        getCurrentUser: () => currentUser,
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

/** Sidebar-scoped queries: 'Dashboard' and 'Kamera' also live in the mobile dock. */
const sidebar = () => within(screen.getByRole('navigation', { name: 'Navigasi admin' }));

function renderShell(path = '/admin/dashboard') {
    return render(
        <TestRouter initialEntries={[path]}>
            <AdminLayout>
                <div>Content</div>
            </AdminLayout>
        </TestRouter>
    );
}

describe('admin navigation model', () => {
    it('gives every destination its own icon — the old set reused one glyph for four routes', () => {
        const items = NAV_GROUPS.flatMap((group) => group.items);
        expect(new Set(items.map((item) => item.icon)).size).toBe(items.length);
    });

    it('keeps every destination reachable from exactly one group', () => {
        const paths = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.path));
        expect(new Set(paths).size).toBe(paths.length);
    });

    it('hides admin-only destinations from viewer accounts and drops groups left empty', () => {
        const viewerGroups = filterNavGroups(false);
        const viewerPaths = viewerGroups.flatMap((g) => g.items.map((i) => i.path));
        expect(viewerPaths).not.toContain('/admin/users');
        expect(viewerPaths).not.toContain('/admin/billing');
        expect(viewerGroups.every((g) => g.items.length > 0)).toBe(true);
        expect(viewerGroups.map((g) => g.id)).not.toContain('pelanggan');
    });

    it('filters by label and never leaves a bare group heading behind', () => {
        const groups = filterNavGroups(true, 'voucher');
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map((i) => i.label)).toEqual(['Voucher Akses']);
    });
});

describe('AdminLayout shell', () => {
    beforeEach(() => {
        currentUser = { id: 1, username: 'admin', role: 'admin' };
        localStorage.clear();
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockReturnValue({ matches: false }),
        });
    });

    it('renders the grouped section headings on semantic tokens, not raw greys', () => {
        renderShell();
        const heading = screen.getByText('Operasi');
        expect(heading.className).toContain('text-content-subtle');
        expect(heading.className).not.toContain('gray-');
        expect(screen.getByText('Rekaman', { selector: 'p' })).toBeTruthy();
        expect(screen.getByText('Sistem')).toBeTruthy();
    });

    it('marks the current route with aria-current so it is announced, not just coloured', () => {
        renderShell('/admin/cameras');
        expect(sidebar().getByRole('link', { name: 'Kamera' }).getAttribute('aria-current')).toBe('page');
        expect(sidebar().getByRole('link', { name: 'Area' }).getAttribute('aria-current')).toBeNull();
    });

    it('narrows the sidebar with the nav search', () => {
        renderShell();
        expect(sidebar().getByRole('link', { name: 'Dashboard' })).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Cari menu admin'), { target: { value: 'arsip' } });

        expect(sidebar().getByRole('link', { name: 'Arsip ke Telegram' })).toBeTruthy();
        expect(sidebar().queryByRole('link', { name: 'Dashboard' })).toBeNull();
        expect(screen.queryByText('Operasi')).toBeNull();
    });

    it('explains an empty search result instead of showing a blank sidebar', () => {
        renderShell();
        fireEvent.change(screen.getByLabelText('Cari menu admin'), { target: { value: 'zzz' } });
        expect(screen.getByText(/Tidak ada menu cocok/)).toBeTruthy();
    });

    it('keeps the recording and playback destinations linked', () => {
        renderShell();
        expect(screen.getByRole('link', { name: 'Putar Ulang' }).getAttribute('href')).toBe('/admin/playback');
        expect(screen.getByRole('link', { name: 'Analitik Putar Ulang' }).getAttribute('href')).toBe('/admin/playback-analytics');
        expect(screen.getByRole('link', { name: 'Diagnostik Notifikasi' }).getAttribute('href')).toBe('/admin/notification-diagnostics');
    });

    it('drops admin-only sections for a viewer account', () => {
        currentUser = { id: 2, username: 'viewer', role: 'viewer' };
        renderShell();
        expect(screen.queryByText('Pelanggan')).toBeNull();
        expect(sidebar().queryByRole('link', { name: 'Pengguna' })).toBeNull();
        expect(sidebar().getByRole('link', { name: 'Kamera' })).toBeTruthy();
    });

    it('renders the mobile dock on the named layering tier, below dialogs', () => {
        renderShell();
        const dock = screen.getByTestId('admin-pwa-quick-actions');
        expect(dock.className).toContain('fixed');
        expect(dock.className).toContain('bottom-3');
        expect(dock.className).toContain('z-dock');
        expect(dock.className).not.toContain('z-[1200]');
        expect(dock.querySelector('.grid-cols-5')).toBeTruthy();

        const quickActions = within(dock);
        expect(quickActions.getByRole('link', { name: /Kamera/i }).getAttribute('href')).toBe('/admin/cameras');
        expect(quickActions.getByRole('link', { name: /Diagnostik/i }).getAttribute('href')).toBe('/admin/health-debug');
        expect(quickActions.getByRole('link', { name: /Token/i }).getAttribute('href')).toBe('/admin/playback-tokens');
        expect(quickActions.getByRole('link', { name: /Publik/i }).getAttribute('href')).toBe('/');
    });

    it('menyembunyikan quick action mobile saat menu admin terbuka agar logout tetap bisa diklik', () => {
        renderShell();
        expect(screen.getByTestId('admin-pwa-quick-actions')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /buka menu admin/i }));

        expect(screen.queryByTestId('admin-pwa-quick-actions')).toBeNull();
        expect(screen.getByRole('button', { name: /logout/i })).toBeTruthy();
    });
});
