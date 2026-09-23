// @vitest-environment jsdom

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
    getPaymentGateway: vi.fn(),
    updatePaymentGateway: vi.fn(),
    testPaymentGateway: vi.fn(),
    getPaymentGatewayChannels: vi.fn(),
    // Stabil: komponen menaruh `showError` di dep array useCallback — fn baru tiap render akan
    // memicu useEffect berulang (loop load) yang tidak terjadi di produksi.
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
}));

vi.mock('../../services/billingAdminService', () => ({ default: svc }));
vi.mock('../../contexts/NotificationContext', () => ({ useNotification: () => ({ success: svc.notifySuccess, error: svc.notifyError }) }));

import PaymentGatewayTab from './PaymentGatewayTab';

const GATEWAY_DATA = {
    gateway: 'ipaymu',
    public_base_url: 'https://cctv.example.com',
    supported_gateways: ['manual', 'midtrans', 'ipaymu'],
    ipaymu: { va: '1234', production: true, methods: [{ method: 'va', channel: 'bca', label: 'VA BCA', enabled: true }], api_key_set: true, api_key_hint: '****abcd' },
    midtrans: { production: false, server_key_set: false },
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('PaymentGatewayTab load states', () => {
    it('shows a loading indicator while the settings request is in flight', () => {
        svc.getPaymentGateway.mockReturnValue(new Promise(() => {})); // never resolves
        render(<PaymentGatewayTab />);
        expect(screen.getByText(/Memuat pengaturan gateway/)).toBeTruthy();
        // The fabricated default form must NOT be reachable while loading.
        expect(screen.queryByRole('button', { name: /Simpan Pengaturan Gateway/ })).toBeNull();
    });

    it('renders the real config after a successful load', async () => {
        svc.getPaymentGateway.mockResolvedValue({ success: true, data: GATEWAY_DATA });
        render(<PaymentGatewayTab />);
        await waitFor(() => screen.getByRole('button', { name: /Simpan Pengaturan Gateway/ }));
        expect(screen.getByText('Metode & Bank Pembayaran')).toBeTruthy();
        expect(screen.getByText('VA BCA')).toBeTruthy();
    });

    it('shows an error + retry — NOT a fabricated default form — when the load rejects', async () => {
        svc.getPaymentGateway.mockRejectedValue(new Error('network down'));
        render(<PaymentGatewayTab />);
        await waitFor(() => screen.getByText('Coba lagi'));
        // The dangerous path this guards: Simpan on the fabricated 'manual' form would
        // overwrite the working gateway config with empty credentials.
        expect(screen.queryByRole('button', { name: /Simpan Pengaturan Gateway/ })).toBeNull();
    });

    it('shows an error when the API answers success:false', async () => {
        svc.getPaymentGateway.mockResolvedValue({ success: false, message: 'tidak diizinkan' });
        render(<PaymentGatewayTab />);
        await waitFor(() => screen.getByText('tidak diizinkan'));
        expect(screen.queryByRole('button', { name: /Simpan Pengaturan Gateway/ })).toBeNull();
    });

    it('recovers when the retry succeeds', async () => {
        svc.getPaymentGateway
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce({ success: true, data: GATEWAY_DATA });
        render(<PaymentGatewayTab />);
        await waitFor(() => screen.getByText('Coba lagi'));

        fireEvent.click(screen.getByText('Coba lagi'));

        await waitFor(() => screen.getByRole('button', { name: /Simpan Pengaturan Gateway/ }));
    });
});
