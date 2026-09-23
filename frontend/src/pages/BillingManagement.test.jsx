// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
    getCustomers: vi.fn(),
    getSubscriptions: vi.fn(),
    getPayments: vi.fn(),
    getPlans: vi.fn(),
    getRegistrationSettings: vi.fn(),
    getRegistrations: vi.fn(),
    // Stabil: `reload` di komponen menaruh `showError` di dep array useCallback — fn baru tiap
    // render akan memicu useEffect berulang (loop load) yang tidak terjadi di produksi.
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
}));

vi.mock('../services/billingAdminService', () => ({ default: svc }));
vi.mock('../services/cameraService', () => ({ cameraService: { getAllCameras: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../contexts/NotificationContext', () => ({ useNotification: () => ({ success: svc.notifySuccess, error: svc.notifyError }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }));
// Heavy sub-tabs not under test here.
vi.mock('../components/admin/BillingPlansTab', () => ({ default: () => <div>plans-tab</div> }));
vi.mock('../components/admin/PaymentGatewayTab', () => ({ default: () => <div>gateway-tab</div> }));

import BillingManagement from './BillingManagement';

// Shared by both describes below — the ARIA block needs the same loaded page.
beforeEach(() => {
    svc.getCustomers.mockResolvedValue({ success: true, data: [{ id: 1, username: 'budi', phone: '0812', balance: 50000, camera_count: 1, plan_max_cameras: 3, account_status: 'approved', suspended_subscriptions: 0 }] });
    svc.getSubscriptions.mockResolvedValue({ success: true, data: [] });
    svc.getPayments.mockResolvedValue({ success: true, data: [{ id: 9, username: 'budi', gateway: 'ipaymu', amount: 25000, status: 'pending', created_at: '2026-06-12 10:00:00' }] });
    svc.getPlans.mockResolvedValue({ success: true, data: [{ id: 2, key: 'hemat', name: 'Hemat' }] });
    svc.getRegistrationSettings.mockResolvedValue({ success: true, data: { enabled: true } });
    svc.getRegistrations.mockResolvedValue({ success: true, data: [{ id: 5, username: 'calon', phone: '0813', plan_name: 'Trial', plan_is_trial: 1, plan_trial_days: 3, created_at: '2026-06-12 09:00:00' }] });
});

describe('BillingManagement (responsive shell)', () => {
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
        expect(screen.getByRole('tab', { name: /Persetujuan \(1\)/ })).toBeTruthy();
    });

    it('switches to the Pembayaran tab and shows the payment with a confirm action', async () => {
        render(<BillingManagement />);
        await waitFor(() => screen.getAllByText('budi'));

        fireEvent.click(screen.getByRole('tab', { name: /Pembayaran \(1\)/ }));

        // Confirm action appears (rendered in both the table and the mobile card).
        const confirmBtns = await screen.findAllByRole('button', { name: 'Konfirmasi Bayar' });
        expect(confirmBtns.length).toBeGreaterThanOrEqual(1);
    });

    it('switches to the Persetujuan tab and shows approve/reject for the pending registrant', async () => {
        render(<BillingManagement />);
        await waitFor(() => screen.getAllByText('budi'));

        fireEvent.click(screen.getByRole('tab', { name: /Persetujuan \(1\)/ }));

        expect(await screen.findAllByText('calon')).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: 'Setujui' }).length).toBeGreaterThanOrEqual(1);
    });
});

/*
 * The strip on this page was seven plain <button>s: no role="tab", no aria-selected, no
 * aria-controls, no roving tabindex, no arrow keys. A screen reader announced seven unlabelled
 * buttons and gave no clue which panel was showing; the amber "ada persetujuan" dot was a bare
 * coloured span, so it said nothing at all. Sighted mouse users lost nothing, which is why it
 * survived. These assertions are the thing that stops it coming back — the migration itself is
 * invisible to every other test on this page.
 */
describe('BillingManagement tab strip (ARIA contract)', () => {
    const renderLoaded = async () => {
        render(<BillingManagement />);
        await waitFor(() => screen.getAllByText('budi'));
    };

    it('exposes the seven tabs as a real tablist', async () => {
        await renderLoaded();
        const tablist = screen.getByRole('tablist');
        expect(within(tablist).getAllByRole('tab')).toHaveLength(7);
    });

    it('announces which panel is showing, and moves that announcement on click', async () => {
        await renderLoaded();
        const customers = screen.getByRole('tab', { name: /Pelanggan/ });
        // Anchored: "Gateway Pembayaran" is a tab too.
        const payments = screen.getByRole('tab', { name: /^Pembayaran/ });
        expect(customers.getAttribute('aria-selected')).toBe('true');
        expect(payments.getAttribute('aria-selected')).toBe('false');

        fireEvent.click(payments);

        expect(payments.getAttribute('aria-selected')).toBe('true');
        expect(customers.getAttribute('aria-selected')).toBe('false');
    });

    it('points the selected tab at a panel that actually exists', async () => {
        await renderLoaded();
        const selected = screen.getByRole('tab', { selected: true });
        const panel = screen.getByRole('tabpanel');
        expect(selected.getAttribute('aria-controls')).toBe(panel.id);
        expect(panel.getAttribute('aria-labelledby')).toBe(selected.id);
    });

    it('moves focus and selection with ArrowRight — the keys that used to do nothing', async () => {
        await renderLoaded();
        const customers = screen.getByRole('tab', { name: /Pelanggan/ });
        customers.focus();
        expect(document.activeElement).toBe(customers);

        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });

        const subscriptions = screen.getByRole('tab', { name: /Langganan/ });
        expect(document.activeElement).toBe(subscriptions);
        expect(subscriptions.getAttribute('aria-selected')).toBe('true');
    });

    it('keeps one stop in the tab order (roving tabindex)', async () => {
        await renderLoaded();
        const tabs = screen.getAllByRole('tab');
        expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
        expect(screen.getByRole('tab', { selected: true }).getAttribute('tabindex')).toBe('0');
    });

    it('gives the amber pending dot a name instead of leaving it colour-only', async () => {
        await renderLoaded();
        // The dot only shows while that tab is NOT the one you are looking at.
        expect(screen.getByRole('tab', { name: /Persetujuan \(1\) perlu ditinjau/ })).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /Persetujuan/ }));

        expect(screen.queryByText('perlu ditinjau')).toBeNull();
    });
});

/*
 * A failed fetch used to fall out of `loading` into tabs full of EMPTY arrays — "Pembayaran (0)"
 * and "Belum ada pembayaran" claiming there was no data when the request simply failed. The gate
 * below is what keeps a 500/offline reading as an error instead of as an empty dataset.
 */
describe('BillingManagement load failure', () => {
    it('shows an error + retry instead of fabricated empty tabs when a request rejects', async () => {
        svc.getCustomers.mockRejectedValueOnce(new Error('network down'));
        render(<BillingManagement />);
        await waitFor(() => screen.getByText('Data billing tidak dapat dimuat.'));
        expect(screen.getByText('Coba lagi')).toBeTruthy();
        // "Pembayaran (0)" must not be reachable as a tab panel.
        expect(screen.queryByText('Belum ada pembayaran.')).toBeNull();
    });

    it('names the failed slice when one response is success:false', async () => {
        svc.getPayments.mockResolvedValueOnce({ success: false, message: 'boom' });
        render(<BillingManagement />);
        await waitFor(() => screen.getByText(/Sebagian data gagal dimuat: pembayaran/));
    });

    it('recovers when the retry succeeds', async () => {
        svc.getCustomers.mockRejectedValueOnce(new Error('network down'));
        render(<BillingManagement />);
        await waitFor(() => screen.getByText('Coba lagi'));

        fireEvent.click(screen.getByText('Coba lagi'));

        await waitFor(() => screen.getAllByText('budi'));
    });
});
