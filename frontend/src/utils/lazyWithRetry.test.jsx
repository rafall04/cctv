/*
 * Purpose: Verify a dropped chunk stays recoverable — one reload for a stale deploy, a human card offline, never a dead view.
 * Caller: Frontend focused chunk-resilience test gate.
 * Deps: Vitest, @testing-library/react, lazyWithRetry.
 * MainFuncs: lazyWithRetry tests.
 * SideEffects: Stubs navigator.onLine and window.location.reload for the test environment only.
 */

import { Component, Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lazyWithRetry } from './lazyWithRetry';

const chunkError = () => new Error('Failed to fetch dynamically imported module: /assets/panel-a1b2.js');

function Panel() {
    return <p>panel siap</p>;
}

class Boundary extends Component {
    constructor(props) {
        super(props);
        this.state = { message: null };
    }

    static getDerivedStateFromError(error) {
        return { message: error.message };
    }

    render() {
        return this.state.message ? <p>ledakan: {this.state.message}</p> : this.props.children;
    }
}

const mount = (Lazy) => render(
    <Boundary>
        <Suspense fallback={<span>memuat</span>}>
            <Lazy />
        </Suspense>
    </Boundary>,
);

const setOnline = (value) => Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
});

let reload;

beforeEach(() => {
    window.sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, reload },
    });
    setOnline(true);
});

describe('lazyWithRetry', () => {
    it('renders the module when the chunk loads', async () => {
        const Lazy = lazyWithRetry(() => Promise.resolve({ default: Panel }), 'ok');
        mount(Lazy);

        expect(await screen.findByText('panel siap')).toBeDefined();
        expect(reload).not.toHaveBeenCalled();
    });

    it('reloads once for a stale deploy, then offers a card instead of looping', async () => {
        const importer = vi.fn().mockRejectedValue(chunkError());
        mount(lazyWithRetry(importer, 'stale'));

        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(window.sessionStorage.getItem('lazy-retry:stale')).toBe('1');

        // Same key after the reload landed on the same broken build: no second reload, a card instead.
        const view = mount(lazyWithRetry(importer, 'stale'));

        expect(await view.findByText('Bagian ini belum selesai dimuat')).toBeDefined();
        expect(await view.findByText('Muat ulang')).toBeDefined();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('never reloads an offline browser — it asks, and waits', async () => {
        setOnline(false);
        const importer = vi.fn().mockRejectedValue(chunkError());
        mount(lazyWithRetry(importer, 'offline'));

        expect(await screen.findByText('Koneksi internet terputus')).toBeDefined();
        expect(reload).not.toHaveBeenCalled();
        expect(importer).toHaveBeenCalledTimes(1);

        // Still offline: the button retries, it does not throw the visitor at an error page.
        await act(async () => {
            fireEvent.click(screen.getByText('Coba lagi'));
        });
        expect(reload).not.toHaveBeenCalled();
        expect(screen.getByText('Koneksi internet terputus')).toBeDefined();
    });

    it('picks the chunk up by itself when the network comes back', async () => {
        setOnline(false);
        const importer = vi.fn().mockRejectedValue(chunkError());
        mount(lazyWithRetry(importer, 'reconnect'));
        await screen.findByText('Koneksi internet terputus');

        importer.mockResolvedValue({ default: Panel });
        setOnline(true);
        await act(async () => {
            window.dispatchEvent(new Event('online'));
        });

        expect(await screen.findByText('panel siap')).toBeDefined();
        expect(reload).not.toHaveBeenCalled();
    });

    it('falls back to a visitor-pressed reload when the module map keeps failing', async () => {
        setOnline(false);
        const importer = vi.fn().mockRejectedValue(chunkError());
        mount(lazyWithRetry(importer, 'poisoned'));
        await screen.findByText('Koneksi internet terputus');

        // Network back, but the browser still answers the same URL from its cached failure.
        setOnline(true);
        await act(async () => {
            window.dispatchEvent(new Event('online'));
        });
        expect(await screen.findByText('Bagian ini belum selesai dimuat')).toBeDefined();
        expect(reload).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(screen.getByText('Muat ulang'));
        });
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('still surfaces a genuine module error to the error boundary', async () => {
        const Lazy = lazyWithRetry(() => Promise.reject(new Error('kolom tidak ada')), 'broken');
        mount(Lazy);

        expect(await screen.findByText(/kolom tidak ada/)).toBeDefined();
        expect(reload).not.toHaveBeenCalled();
    });
});
