// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
    getCustomers: vi.fn(),
    getSubscriptions: vi.fn(),
    getPayments: vi.fn(),
    getPlans: vi.fn(),
    getRegistrationSettings: vi.fn(),
    getRegistrations: vi.fn(),
}));

vi.mock('../services/billingAdminService', () => ({ default: svc }));
vi.mock('../services/cameraService', () => ({ cameraService: { getAllCameras: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../contexts/NotificationContext', () => ({ useNotification: () => ({ success: vi.fn(), error: vi.fn() }) }));
// Heavy sub-tabs not under test here.
vi.mock('../components/admin/BillingPlansTab', () => ({ default: () => <div>plans-tab</div> }));
vi.mock('../components/admin/PaymentGatewayTab', () => ({ default: () => <div>gateway-tab</div> }));

import BillingManagement from './BillingManagement';

describe('BillingManagement (responsive shell)', () => {
    beforeEach(() => {
        svc.getCustomers.mockResolvedValue({ success: true, data: [{ id: 1, username: 'budi', phone: '0812', balance: 50000, camera_count: 1, plan_max_cameras: 3, account_status: 'approved', suspended_subscriptions: 0 }] });
        svc.getSubscriptions.mockResolvedValue({ success: true, data: [] });
        svc.getPayments.mockResolvedValue({ success: true, data: [{ id: 9, username: 'budi', gateway: 'ipaymu', amount: 25000, status: 'pending', created_at: '2026-06-12 10:00:00' }] });
        svc.getPlans.mockResolvedValue({ success: true, data: [{ id: 2, key: 'hemat', name: 'Hemat' }] });
        svc.getRegistrationSettings.mockResolvedValue({ success: true, data: { enabled: true } });
        svc.getRegistrations.mockResolvedValue({ success: true, data: [{ id: 5, username: 'calon', phone: '0813', plan_name: 'Trial', plan_is_trial: 1, plan_trial_days: 3, created_at: '2026-06-12 09:00:00' }] });
    });

    it('renders the customers tab by default with the customer (table + card both in DOM)', async () => {
        render(<BillingManagement />);
        await waitFor(() => {
            // username appears in BOTH the desktop table and the mobile card markup.
            expect(screen.getAllByText('budi').length).toBeGreaterThanOrEqual(2);
        });
    });

    it('shows the pending-approval badge count on the Persetujuan tab', async () => {
        render(<BillingManagement />);
        await waitFor(() => screen.getAllByText('budi'));
        expect(screen.getByRole('button', { name: /Persetujuan \(1\)/ })).toBeTruthy();
    });

    it('switches to the Pembayaran tab and shows the payment with a confirm action', async () => {
        render(<BillingManagement />);
        await waitFor(() => screen.getAllByText('budi'));

        fireEvent.click(screen.getByRole('button', { name: /Pembayaran \(1\)/ }));

        // Confirm action appears (rendered in both the table and the mobile card).
        const confirmBtns = await screen.findAllByRole('button', { name: 'Konfirmasi Bayar' });
        expect(confirmBtns.length).toBeGreaterThanOrEqual(1);
    });

    it('switches to the Persetujuan tab and shows approve/reject for the pending registrant', async () => {
        render(<BillingManagement />);
        await waitFor(() => screen.getAllByText('budi'));

        fireEvent.click(screen.getByRole('button', { name: /Persetujuan \(1\)/ }));

        expect(await screen.findAllByText('calon')).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: 'Setujui' }).length).toBeGreaterThanOrEqual(1);
    });
});
