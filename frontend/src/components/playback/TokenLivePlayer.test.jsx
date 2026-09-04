// @vitest-environment jsdom

/*
 * Purpose: Verify the token-holder live player mounts, requests a live grant, and shows the modal.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library, vitest, mocked streamTokenService.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/streamTokenService', () => ({
    // Pending promise: the component stays on its loading state, so the hls.js branch never runs.
    getLiveGrant: vi.fn(() => new Promise(() => {})),
    buildSecureStreamUrl: vi.fn((url, token) => `${url}?token=${token}`),
}));

import { getLiveGrant } from '../../services/streamTokenService';
import TokenLivePlayer from './TokenLivePlayer.jsx';

describe('TokenLivePlayer', () => {
    beforeEach(() => vi.clearAllMocks());

    it('mounts the live modal for the camera and requests a live grant from the token', () => {
        render(
            <TokenLivePlayer
                camera={{ id: 42, name: 'Depan Rumah Aldi', area_name: 'Rumah Aldi' }}
                onClose={vi.fn()}
            />
        );

        // The grant is fetched from the playback token (cookie), keyed by camera id.
        expect(getLiveGrant).toHaveBeenCalledWith(42);
        // Modal chrome + loading state render.
        expect(screen.getByText(/Live · Depan Rumah Aldi/)).toBeTruthy();
        expect(screen.getByText(/Memuat siaran langsung/i)).toBeTruthy();
    });
});
