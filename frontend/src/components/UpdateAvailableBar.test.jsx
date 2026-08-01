/*
 * Purpose: The update offer stays invisible until there is one, and only a tap reloads.
 * Caller: `npm test -- src/components/UpdateAvailableBar.test.jsx`.
 * Deps: vitest, @testing-library/react, ./UpdateAvailableBar.jsx.
 * MainFuncs: Tests for UpdateAvailableBar.
 * SideEffects: Dispatches the SW update-ready event on window.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import UpdateAvailableBar from './UpdateAvailableBar.jsx';
import { SW_UPDATE_READY_EVENT } from '../utils/registerServiceWorker.js';

const announce = (apply) => act(() => {
    window.dispatchEvent(new CustomEvent(SW_UPDATE_READY_EVENT, { detail: { apply } }));
});

describe('UpdateAvailableBar', () => {
    it('renders nothing until an update is actually waiting', () => {
        render(<UpdateAvailableBar />);
        expect(screen.queryByTestId('update-available-bar')).toBeNull();
    });

    it('appears when an update is announced, without applying it', () => {
        const apply = vi.fn();
        render(<UpdateAvailableBar />);
        announce(apply);

        expect(screen.getByTestId('update-available-bar')).toBeTruthy();
        // Guards the useState-updater trap: storing the callback must not call it.
        expect(apply).not.toHaveBeenCalled();
    });

    it('applies the update only when the visitor taps Muat ulang', () => {
        const apply = vi.fn();
        render(<UpdateAvailableBar />);
        announce(apply);

        fireEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('can be dismissed without updating', () => {
        const apply = vi.fn();
        render(<UpdateAvailableBar />);
        announce(apply);

        fireEvent.click(screen.getByRole('button', { name: /Tutup pemberitahuan/ }));
        expect(screen.queryByTestId('update-available-bar')).toBeNull();
        expect(apply).not.toHaveBeenCalled();
    });

    it('stops listening once unmounted', () => {
        const apply = vi.fn();
        const { unmount } = render(<UpdateAvailableBar />);
        unmount();
        announce(apply);

        expect(screen.queryByTestId('update-available-bar')).toBeNull();
    });
});
