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

const { getMyCamerasMock, getPlanMock } = vi.hoisted(() => ({
    getMyCamerasMock: vi.fn(),
    getPlanMock: vi.fn(),
}));

vi.mock('../../services/customerService', () => ({
    default: {
        getMyCameras: getMyCamerasMock,
        getPlan: getPlanMock,
        createCamera: vi.fn(),
        updateCamera: vi.fn(),
        deleteCamera: vi.fn(),
    },
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
        getPlanMock.mockReset();
        getPlanMock.mockResolvedValue({ success: true, data: { plan: null, used_cameras: 0, max_cameras: 0, can_add_camera: false } });
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

    it('shows the plan limit indicator and disables add when the quota is full', async () => {
        getMyCamerasMock.mockResolvedValue({
            success: true,
            data: [{ id: 1, name: 'Kamera Toko', is_online: 1, billing_status: 'active', monthly_price: 20000 }],
        });
        getPlanMock.mockResolvedValue({
            success: true,
            data: {
                plan: { id: 2, key: 'basic', name: 'Basic' },
                used_cameras: 1,
                max_cameras: 1,
                can_add_camera: false,
                trial_expired: false,
            },
        });
        renderPage();

        await waitFor(() => {
            expect(screen.getByText(/1\/1 kamera \(Basic\)/)).toBeTruthy();
        });
        const addButton = screen.getByRole('button', { name: /Tambah Kamera/ });
        expect(addButton.disabled).toBe(true);
        expect(screen.getByText(/upgrade paket/)).toBeTruthy();
    });
});

