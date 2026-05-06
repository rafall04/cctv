/*
 * Purpose: Verify public/admin PWA install prompt behaves like a dismissible toast and respects install capability.
 * Caller: Frontend focused PWA prompt test gate.
 * Deps: React Testing Library, React Router, Vitest, PwaInstallPrompt.
 * MainFuncs: PWA install prompt tests.
 * SideEffects: Mocks timers, localStorage, and browser install prompt event.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PwaInstallPrompt from './PwaInstallPrompt';

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
        expect(screen.getByText('Install RAF NET Admin')).toBeTruthy();

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
});
