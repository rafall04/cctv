// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/ApiClientInitializer', () => ({
    ApiClientInitializer: ({ children }) => <>{children}</>,
}));

vi.mock('./components/ui/ToastContainer', () => ({
    ToastContainer: () => null,
}));

vi.mock('./layouts/AdminLayout', () => ({
    default: ({ children }) => <div data-testid="admin-layout">{children}</div>,
}));

vi.mock('./pages/LandingPage', () => ({
    default: () => <div>landing-page</div>,
}));

vi.mock('./pages/LoginPage', () => ({
    default: () => <div>login-page</div>,
}));

vi.mock('./pages/Dashboard', () => ({
    default: () => <div>dashboard-page</div>,
}));

vi.mock('./pages/CameraManagement', () => ({
    default: () => <div>camera-page</div>,
}));

vi.mock('./pages/admin/BackupRestore', () => ({
    default: () => <div>backup-restore-page</div>,
}));

vi.mock('./pages/admin/HealthDebug', () => ({
    default: () => <div>health-debug-page</div>,
}));

vi.mock('./pages/AreaManagement', () => ({
    default: () => <div>area-page</div>,
}));

vi.mock('./pages/UserManagement', () => ({
    default: () => <div>user-page</div>,
}));

vi.mock('./pages/FeedbackManagement', () => ({
    default: () => <div>feedback-page</div>,
}));

vi.mock('./pages/ViewerAnalytics', () => ({
    default: () => <div>analytics-page</div>,
}));

vi.mock('./pages/PlaybackAnalytics', () => ({
    default: () => <div>playback-analytics-page</div>,
}));

vi.mock('./pages/UnifiedSettings', () => ({
    default: () => <div>settings-page</div>,
}));

vi.mock('./pages/SponsorManagement', () => ({
    default: () => <div>sponsor-page</div>,
}));

vi.mock('./pages/RecordingDashboard', () => ({
    default: () => <div>recording-page</div>,
}));

vi.mock('./pages/Playback', () => ({
    default: () => <div>playback-page</div>,
}));

describe('App admin routing', () => {
    beforeEach(() => {
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        localStorage.setItem('user', JSON.stringify({ id: 1, username: 'admin' }));
        window.history.pushState({}, '', '/admin/dashboard');
    });

    it('merender route admin terproteksi di dalam layout admin', async () => {
        render(<App />);

        await waitFor(() => {
            expect(screen.getByTestId('admin-layout')).toBeTruthy();
        });

        await waitFor(() => {
            expect(screen.getByText('dashboard-page')).toBeTruthy();
        });
    });

    it('merender route health debug di dalam layout admin', async () => {
        window.history.pushState({}, '', '/admin/health-debug');

        render(<App />);

        await waitFor(() => {
            expect(screen.getByTestId('admin-layout')).toBeTruthy();
        });

        await waitFor(() => {
            expect(screen.getByText('health-debug-page')).toBeTruthy();
        });
    });

    it('merender route playback admin di dalam layout admin', async () => {
        window.history.pushState({}, '', '/admin/playback');

        render(<App />);

        await waitFor(() => {
            expect(screen.getByTestId('admin-layout')).toBeTruthy();
        });

        await waitFor(() => {
            expect(screen.getByText('playback-page')).toBeTruthy();
        });
    });

    it('merender route playback analytics admin di dalam layout admin', async () => {
        window.history.pushState({}, '', '/admin/playback-analytics');

        render(<App />);

        await waitFor(() => {
            expect(screen.getByTestId('admin-layout')).toBeTruthy();
        });

        await waitFor(() => {
            expect(screen.getByText('playback-analytics-page')).toBeTruthy();
        });
    });
});
