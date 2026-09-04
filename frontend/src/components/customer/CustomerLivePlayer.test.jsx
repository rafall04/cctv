// @vitest-environment jsdom

/*
 * Purpose: Verify the portal live player renders its OWN amber suspension card when the gated stream
 *          fetch returns 402 — the shared core reports kind='payment', the component styles it.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library, vitest, mocked streamService + streamTokenService.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/streamService', () => ({
    default: { getStreamUrls: vi.fn() },
}));
vi.mock('../../services/streamTokenService', () => ({
    getSecureStreamUrl: vi.fn(() => Promise.resolve({ token: 't' })),
    buildSecureStreamUrl: vi.fn((url, token) => `${url}?token=${token}`),
    clearTokenCache: vi.fn(),
}));

import streamService from '../../services/streamService';
import CustomerLivePlayer from './CustomerLivePlayer.jsx';

describe('CustomerLivePlayer', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows the amber suspension card when the stream fetch returns 402', async () => {
        streamService.getStreamUrls.mockRejectedValue({ response: { status: 402 } });
        render(<CustomerLivePlayer camera={{ id: 5, name: 'Kamera Toko' }} onClose={vi.fn()} />);
        await waitFor(() => expect(screen.getByText(/Saldo habis — kamera ditangguhkan/i)).toBeTruthy());
    });
});
