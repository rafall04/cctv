// @vitest-environment jsdom

/*
 * Purpose: Lock the shared live-player core's error classification + side-effect contract, since two
 *          players (TokenLivePlayer, CustomerLivePlayer) now depend on it — a silent change here would
 *          break both. The resolveStream-reject path short-circuits before hls.js loads, so these
 *          cases need no hls mock.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library, vitest.
 */

import { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useHlsLivePlayer } from './useHlsLivePlayer';

function Harness(props) {
    const videoRef = useRef(null);
    const state = useHlsLivePlayer({ videoRef, resetKey: 'cam', ...props });
    return (
        <div>
            <video ref={videoRef} />
            <span data-testid="status">{state.status}</span>
            <span data-testid="kind">{String(state.kind)}</span>
            <span data-testid="message">{state.message}</span>
        </div>
    );
}

const rejectWith = (status) => () => Promise.reject(Object.assign(new Error('x'), { response: { status } }));

async function expectError(kind, message) {
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('kind').textContent).toBe(kind);
    if (message !== undefined) expect(screen.getByTestId('message').textContent).toBe(message);
}

describe('useHlsLivePlayer error classification', () => {
    it('maps HTTP 402 to a payment kind with the default message', async () => {
        render(<Harness resolveStream={rejectWith(402)} />);
        await expectError('payment', 'Kamera ditangguhkan.');
    });

    it('maps HTTP 401/403 to denied and fires onError once with the kind', async () => {
        const onError = vi.fn();
        render(<Harness resolveStream={rejectWith(403)} onError={onError} />);
        await expectError('denied');
        expect(onError).toHaveBeenCalledWith({ kind: 'denied', httpCode: 403 });
    });

    it('maps HTTP 404 to notfound', async () => {
        render(<Harness resolveStream={rejectWith(404)} />);
        await expectError('notfound');
    });

    it('carries a friendly error message through unchanged', async () => {
        const resolveStream = () => Promise.reject(Object.assign(new Error('Stream live tidak tersedia'), { friendly: true }));
        render(<Harness resolveStream={resolveStream} />);
        await expectError('unknown', 'Stream live tidak tersedia');
    });

    it('lets a caller override the copy per kind', async () => {
        render(<Harness resolveStream={rejectWith(402)} messages={{ payment: 'Saldo habis — kamera ditangguhkan.' }} />);
        await expectError('payment', 'Saldo habis — kamera ditangguhkan.');
    });

    it('lets mapError build a dynamic message (e.g. embed the HTTP code)', async () => {
        const mapError = ({ kind, httpCode }) => (kind === 'notfound' ? `Tidak ada (HTTP ${httpCode})` : undefined);
        render(<Harness resolveStream={rejectWith(404)} mapError={mapError} />);
        await expectError('notfound', 'Tidak ada (HTTP 404)');
    });
});
