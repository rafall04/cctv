// @vitest-environment jsdom

/*
 * Purpose: Guard the notification shorthand — showNotification('pesan', 'success') must render
 *   readable text, not an empty toast. A string used to fall through as {title: undefined},
 *   producing a visible but blank box on the admin archive and ronda pages.
 * Caller: Frontend Vitest suite for contexts/NotificationContext.jsx.
 * Deps: React Testing Library, Vitest.
 * MainFuncs: showNotification shorthand + object form behaviour tests.
 * SideEffects: Renders a harness in jsdom.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationProvider, useNotification } from './NotificationContext.jsx';
import { ToastContainer } from '../components/ui/ToastContainer.jsx';

function Harness({ fire }) {
    const api = useNotification();
    return <button type="button" onClick={() => fire(api)}>trigger</button>;
}

function renderHarness(fire) {
    return render(
        <NotificationProvider>
            <Harness fire={fire} />
            <ToastContainer />
        </NotificationProvider>,
    );
}

afterEach(cleanup);

describe('showNotification shorthand', () => {
    it('renders the text when called as (message, type)', async () => {
        renderHarness((api) => api.showNotification('Rute ditambahkan.', 'success'));
        fireEvent.click(screen.getByRole('button', { name: 'trigger' }));

        await waitFor(() => expect(screen.getByText('Rute ditambahkan.')).toBeTruthy());
    });

    it('defaults to info when no type is given', async () => {
        renderHarness((api) => api.showNotification('Sekadar kabar'));
        fireEvent.click(screen.getByRole('button', { name: 'trigger' }));

        await waitFor(() => expect(screen.getByText('Sekadar kabar')).toBeTruthy());
    });

    it('still supports the object form', async () => {
        renderHarness((api) => api.showNotification({
            type: 'error', title: 'Gagal menyimpan', message: 'Coba lagi',
        }));
        fireEvent.click(screen.getByRole('button', { name: 'trigger' }));

        await waitFor(() => expect(screen.getByText('Gagal menyimpan')).toBeTruthy());
        expect(screen.getByText('Coba lagi')).toBeTruthy();
    });

    it('keeps the success/error helpers working', async () => {
        renderHarness((api) => api.error('Grup tidak ditemukan'));
        fireEvent.click(screen.getByRole('button', { name: 'trigger' }));

        await waitFor(() => expect(screen.getByText('Grup tidak ditemukan')).toBeTruthy());
    });

    it('never renders a toast with no readable text', async () => {
        renderHarness((api) => api.showNotification('Isi ID grup dulu', 'warning'));
        fireEvent.click(screen.getByRole('button', { name: 'trigger' }));

        const region = await screen.findByLabelText('Notifications');
        expect(region.textContent.trim().length).toBeGreaterThan(0);
    });
});
