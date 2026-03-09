// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/ApiClientInitializer', () => ({
    ApiClientInitializer: ({ children }) => <>{children}</>,
}));

vi.mock('./components/ui/ToastContainer', () => ({
    ToastContainer: () => null,
}));

vi.mock('./pages/LandingPage', () => ({
    default: () => <div data-testid="public-landing-page">landing-page</div>,
}));

vi.mock('./pages/LoginPage', () => ({
    default: () => <div>login-page</div>,
}));

vi.mock('./layouts/AdminLayout', () => ({
    default: ({ children }) => <div data-testid="admin-layout">{children}</div>,
}));

describe('App public routing', () => {
    beforeEach(() => {
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    });

    it('merender route publik tanpa memerlukan layout admin', async () => {
        window.history.pushState({}, '', '/');

        render(<App />);

        expect(screen.getByTestId('public-landing-page')).toBeTruthy();
        expect(screen.queryByTestId('admin-layout')).toBeNull();
    });
});
