/*
 * Purpose: Verify the customer camera grid renders owned cameras, billing badges, and the
 *          suspended state without leaking other behavior.
 * Caller: Frontend focused customer portal test gate.
 * Deps: vitest, testing-library, mocked customerService/player.
 * MainFuncs: MyCameras render tests.
 * SideEffects: None (mocked services).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { getMyCamerasMock } = vi.hoisted(() => ({
    getMyCamerasMock: vi.fn(),
}));

vi.mock('../../services/customerService', () => ({
    default: { getMyCameras: getMyCamerasMock },
}));

vi.mock('../../components/customer/CustomerLivePlayer', () => ({
    default: () => <div data-testid="live-player" />,
}));

import MyCameras from './MyCameras';

function renderPage() {
    return render(
        <MemoryRouter>
            <MyCameras />
        </MemoryRouter>
    );
}

describe('MyCameras', () => {
    beforeEach(() => {
        getMyCamerasMock.mockReset();
    });

    it('shows the empty state when the customer has no cameras', async () => {
        getMyCamerasMock.mockResolvedValue({ success: true, data: [] });
        renderPage();
        await waitFor(() => {
            expect(screen.getByText('Belum ada kamera')).toBeTruthy();
        });
    });

    it('renders owned cameras with online and suspended badges', async () => {
        getMyCamerasMock.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 1,
                    name: 'Kamera Toko',
                    location: 'Depan Toko',
                    is_online: 1,
                    billing_status: 'active',
                    monthly_price: 20000,
                },
                {
                    id: 2,
                    name: 'Kamera Gudang',
                    location: 'Gudang Belakang',
                    is_online: 1,
                    billing_status: 'suspended',
                    monthly_price: 20000,
                },
            ],
        });
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('Kamera Toko')).toBeTruthy();
        });
        expect(screen.getByText('Online')).toBeTruthy();
        expect(screen.getByText('Ditangguhkan')).toBeTruthy();
        expect(screen.getAllByText(/Rp20.000\/bulan/)).toHaveLength(2);
        // Suspended card carries the top-up call to action.
        expect(screen.getByText('isi saldo')).toBeTruthy();
    });

    it('surfaces a load error', async () => {
        getMyCamerasMock.mockRejectedValue(new Error('network'));
        renderPage();
        await waitFor(() => {
            expect(screen.getByText(/Gagal memuat kamera/)).toBeTruthy();
        });
    });
});

