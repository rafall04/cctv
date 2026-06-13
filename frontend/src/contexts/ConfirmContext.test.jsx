// @vitest-environment jsdom

/*
 * Purpose: Verify useConfirm resolves true/false on confirm/cancel/Escape and
 *   requires a provider.
 * Caller: Frontend Vitest suite for contexts/ConfirmContext.jsx.
 * Deps: React Testing Library, Vitest.
 * MainFuncs: useConfirm / ConfirmDialog behavior tests.
 * SideEffects: Renders a harness in jsdom.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider, useConfirm } from './ConfirmContext.jsx';

function Harness({ onResult }) {
    const confirm = useConfirm();
    return (
        <button
            type="button"
            onClick={async () => {
                const result = await confirm({ message: 'Yakin?', confirmLabel: 'Ya', cancelLabel: 'Batal' });
                onResult(result);
            }}
        >
            trigger
        </button>
    );
}

afterEach(() => {
    cleanup();
});

describe('useConfirm / ConfirmDialog', () => {
    it('resolves true when confirmed', async () => {
        const onResult = vi.fn();
        render(<ConfirmProvider><Harness onResult={onResult} /></ConfirmProvider>);
        fireEvent.click(screen.getByText('trigger'));
        expect(await screen.findByText('Yakin?')).toBeTruthy();
        fireEvent.click(screen.getByText('Ya'));
        await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    });

    it('resolves false when cancelled', async () => {
        const onResult = vi.fn();
        render(<ConfirmProvider><Harness onResult={onResult} /></ConfirmProvider>);
        fireEvent.click(screen.getByText('trigger'));
        await screen.findByText('Yakin?');
        fireEvent.click(screen.getByText('Batal'));
        await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    });

    it('resolves false on Escape', async () => {
        const onResult = vi.fn();
        render(<ConfirmProvider><Harness onResult={onResult} /></ConfirmProvider>);
        fireEvent.click(screen.getByText('trigger'));
        const heading = await screen.findByText('Yakin?');
        fireEvent.keyDown(heading, { key: 'Escape' });
        await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    });

    it('throws when used outside a ConfirmProvider', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<Harness onResult={() => {}} />)).toThrow(/ConfirmProvider/);
        spy.mockRestore();
    });
});
