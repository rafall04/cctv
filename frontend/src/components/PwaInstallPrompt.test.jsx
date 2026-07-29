/*
 * Purpose: Verify public/admin PWA install prompt behaves like a dismissible toast and respects install capability.
 * Caller: Frontend focused PWA prompt test gate.
 * Deps: React Testing Library, React Router, Vitest, PwaInstallPrompt.
 * MainFuncs: PWA install prompt tests.
 * SideEffects: Mocks timers, localStorage, and browser install prompt event.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PwaInstallPrompt from './PwaInstallPrompt';

function setManifest(href) {
    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
        link = document.createElement('link');
        link.rel = 'manifest';
        document.head.appendChild(link);
    }
    link.setAttribute('href', href);
    return link;
}

function GoTo({ to }) {
    const navigate = useNavigate();
    useEffect(() => { if (to) navigate(to); }, [to, navigate]);
    return null;
}

function dispatchInstallPromptEvent() {
    const event = new Event('beforeinstallprompt');
    event.preventDefault = vi.fn();
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
    return event;
}

describe('PwaInstallPrompt', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        setManifest('/site.webmanifest?v=1');
        delete window.__deferredInstallPrompt;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockReturnValue({ matches: false }),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('shows a delayed install toast and installs through the captured prompt event', async () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <PwaInstallPrompt delayMs={100} />
            </MemoryRouter>
        );

        let event;
        await act(async () => {
            event = dispatchInstallPromptEvent();
            await Promise.resolve();
        });

        await act(async () => {
            vi.advanceTimersByTime(100);
        });

        expect(screen.getByTestId('pwa-install-prompt')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Install/i }));
            await Promise.resolve();
        });

        expect(event.prompt).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('rafnet_pwa_prompt_dismissed')).toBe('true');
    });

    it('uses admin copy and dismissal key on admin routes', async () => {
        setManifest('/admin.webmanifest?v=1');
        render(
            <MemoryRouter initialEntries={['/admin/dashboard']}>
                <PwaInstallPrompt delayMs={100} />
            </MemoryRouter>
        );

        let event;
        await act(async () => {
            event = dispatchInstallPromptEvent();
            await Promise.resolve();
        });

        await act(async () => {
            vi.advanceTimersByTime(100);
        });

        expect(screen.getByTestId('pwa-install-prompt').className).toContain('bottom-24');
        expect(screen.getByText('Install CCTV Admin')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Install/i }));
            await Promise.resolve();
        });

        expect(event.prompt).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('rafnet_admin_pwa_prompt_dismissed')).toBe('true');
        expect(localStorage.getItem('rafnet_pwa_prompt_dismissed')).toBeNull();
    });

    it('does not show after route-specific dismissal', async () => {
        localStorage.setItem('rafnet_pwa_prompt_dismissed', 'true');

        render(
            <MemoryRouter initialEntries={['/']}>
                <PwaInstallPrompt delayMs={100} />
            </MemoryRouter>
        );

        await act(async () => {
            dispatchInstallPromptEvent();
            await Promise.resolve();
        });

        await act(async () => {
            vi.advanceTimersByTime(100);
        });

        expect(screen.queryByTestId('pwa-install-prompt')).toBeNull();
    });

    /*
     * The browser binds `beforeinstallprompt` to whatever manifest is linked when it FIRES, and
     * never re-binds it. So after a client-side move from / to /admin the captured event still
     * installs the PUBLIC app. Showing an "Install CCTV Admin" button wired to that event would
     * install the wrong app — the toast must stay hidden instead.
     */
    it('stays hidden after navigating / -> /admin, because the event installs the PUBLIC app', async () => {
        setManifest('/site.webmanifest?v=1');
        const { rerender } = render(
            <MemoryRouter initialEntries={['/']}>
                <PwaInstallPrompt delayMs={100} />
                <GoTo to={null} />
            </MemoryRouter>
        );

        // Event fires while the PUBLIC manifest is linked — this is the real sequence.
        await act(async () => { dispatchInstallPromptEvent(); await Promise.resolve(); });

        rerender(
            <MemoryRouter initialEntries={['/']}>
                <PwaInstallPrompt delayMs={100} />
                <GoTo to="/admin/dashboard" />
            </MemoryRouter>
        );
        await act(async () => { vi.advanceTimersByTime(500); });

        // The toast would have said "Install CCTV Admin" while installing the public app.
        expect(screen.queryByTestId('pwa-install-prompt')).toBeNull();
    });

    it('points <link rel="manifest"> at the admin app while on an admin route', async () => {
        setManifest('/site.webmanifest?v=1');
        render(
            <MemoryRouter initialEntries={['/admin/cameras']}>
                <PwaInstallPrompt delayMs={100} />
            </MemoryRouter>
        );

        await act(async () => { await Promise.resolve(); });

        expect(document.querySelector('link[rel="manifest"]').getAttribute('href'))
            .toBe('/admin.webmanifest?v=1');
    });

    /*
     * THE bug behind "sudah refresh berkali-kali, popup tidak muncul sama sekali".
     * `beforeinstallprompt` fires once per page load. React attaches its listener from a useEffect,
     * which on /admin only runs after the lazy admin chunks have loaded — a much longer window than
     * on the public landing. An event that fires in that window is missed FOREVER, so no amount of
     * refreshing helps. index.html now captures it into window.__deferredInstallPrompt before React
     * exists, and the component adopts it on mount.
     */
    it('adopts an install event that fired BEFORE React mounted', async () => {
        setManifest('/admin.webmanifest?v=1');
        const early = new Event('beforeinstallprompt');
        early.preventDefault = vi.fn();
        early.prompt = vi.fn().mockResolvedValue(undefined);
        early.userChoice = Promise.resolve({ outcome: 'accepted' });
        // Exactly what the inline script in index.html leaves behind.
        window.__deferredInstallPrompt = { event: early, manifest: '/admin.webmanifest?v=1' };

        render(
            <MemoryRouter initialEntries={['/admin/login']}>
                <PwaInstallPrompt delayMs={100} />
            </MemoryRouter>
        );

        await act(async () => { vi.advanceTimersByTime(200); });

        expect(screen.getByTestId('pwa-install-prompt')).toBeTruthy();
        expect(screen.getByText('Install CCTV Admin')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^Install$/i }));
            await Promise.resolve();
        });
        expect(early.prompt).toHaveBeenCalledTimes(1);
    });

});
