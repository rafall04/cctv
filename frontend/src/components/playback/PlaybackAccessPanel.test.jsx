// @vitest-environment jsdom

/*
 * Purpose: Pin the buyer form to the 16px control floor — this panel is the money path.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked playbackAccessService.
 * SideEffects: jsdom render only.
 *
 * Nama and Nomor HP inherited 12px from their wrapping `text-xs` label (Tailwind preflight sets
 * input font-size:100%), so Safari iOS zoomed the page in the instant a buyer touched either
 * field — mid-purchase, on the one form we most need finished.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackAccessPanel from './PlaybackAccessPanel';
import playbackAccessService from '../../services/playbackAccessService';

vi.mock('../../services/playbackAccessService', () => ({
    default: {
        getProducts: vi.fn(),
        claimTrial: vi.fn(),
        createOrder: vi.fn(),
        getOrderStatus: vi.fn(),
    },
}));

const PRODUCTS = [
    { key: 'harian', label: 'Paket harian', price: 15000, windowHours: 24, validityDays: 1, isTrial: false },
];

beforeEach(() => {
    vi.clearAllMocks();
    playbackAccessService.getProducts.mockResolvedValue({ data: { products: PRODUCTS, trial: null } });
});

describe('PlaybackAccessPanel buyer form on a phone', () => {
    it('keeps Nama and Nomor HP at the 16px floor, shrinking only from sm up', async () => {
        render(<PlaybackAccessPanel />);

        const name = await screen.findByLabelText('Nama');
        const phone = screen.getByLabelText('Nomor HP');

        for (const field of [name, phone]) {
            const cls = field.getAttribute('class');
            expect(cls).toContain('text-base');
            expect(cls).toContain('sm:text-sm');
            // The 40px touch floor: py-1.5 around 16px text is only 38px on its own.
            expect(cls).toContain('min-h-11');
            expect(cls).toContain('sm:min-h-0');
        }
    });
});
