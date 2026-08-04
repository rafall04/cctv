/*
 * Purpose: Pin the admin plan form's pricing fields — the recording surcharge must reach the
 *          API, must never ride along on a trial plan, and must survive an edit round-trip.
 * Caller: Frontend test gate.
 * Deps: vitest, @testing-library/react, mocked billingAdminService.
 * MainFuncs: BillingPlansTab pricing tests.
 * SideEffects: None (service mocked).
 *
 * WHY THESE AND NOT SNAPSHOTS
 * A price input that renders correctly but is dropped from the payload looks perfectly
 * fine on screen and silently bills the wrong amount. So every assertion here is on what
 * the component SENDS, not on what it draws.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BillingPlansTab from './BillingPlansTab';

vi.mock('../../services/billingAdminService', () => ({
    default: {
        createPlan: vi.fn(() => Promise.resolve({ success: true })),
        updatePlan: vi.fn(() => Promise.resolve({ success: true })),
        updateRegistrationSettings: vi.fn(() => Promise.resolve({ success: true })),
    },
}));

import billingAdminService from '../../services/billingAdminService';

const PLANS = [
    { id: 1, key: 'trial', name: 'Trial Gratis', price_per_camera: 0, recording_price_per_camera: 0, max_cameras: 3, is_trial: 1, trial_days: 7, active: 1, sort_order: 1 },
    { id: 2, key: 'basic', name: 'Basic', price_per_camera: 15000, recording_price_per_camera: 0, max_cameras: 1, is_trial: 0, trial_days: null, active: 1, sort_order: 2 },
    { id: 3, key: 'bisnis', name: 'Bisnis', price_per_camera: 8000, recording_price_per_camera: 12000, max_cameras: 10, is_trial: 0, trial_days: null, active: 1, sort_order: 3 },
];

// `run` is the page-level helper that wraps a mutation; here it just executes it.
const run = vi.fn(async (fn) => { await fn(); return true; });

function renderTab() {
    return render(
        <BillingPlansTab
            plans={PLANS}
            regSettings={{ enabled: true, default_plan_key: 'trial' }}
            run={run}
            busy={false}
        />
    );
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('BillingPlansTab — harga sewa', () => {
    it('shows the recording surcharge as an add-on, and a dash when there is none', () => {
        renderTab();
        // Bisnis carries a surcharge; it must read as additive, not as a replacement price.
        expect(screen.getByText('+Rp12.000')).toBeTruthy();
        // Basic has none, Trial cannot have one -> two dashes.
        expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    });

    it('sends the recording surcharge when creating a paid plan', async () => {
        renderTab();
        fireEvent.click(screen.getByText('+ Paket Baru'));

        fireEvent.change(screen.getByPlaceholderText(/key unik/i), { target: { name: 'key', value: 'rekam' } });
        fireEvent.change(screen.getByPlaceholderText('Nama paket'), { target: { name: 'name', value: 'Rekam' } });
        fireEvent.change(screen.getByLabelText(/Harga per kamera per bulan/i), { target: { name: 'price_per_camera', value: '8000' } });
        fireEvent.change(screen.getByLabelText(/Tambahan harga bila kamera merekam/i), { target: { name: 'recording_price_per_camera', value: '12000' } });

        fireEvent.click(screen.getByText('Simpan'));

        await waitFor(() => expect(billingAdminService.createPlan).toHaveBeenCalled());
        expect(billingAdminService.createPlan.mock.calls[0][0]).toMatchObject({
            key: 'rekam',
            price_per_camera: 8000,
            recording_price_per_camera: 12000,
        });
    });

    it('never sends a recording surcharge on a trial plan, even if one was typed first', async () => {
        renderTab();
        fireEvent.click(screen.getByText('+ Paket Baru'));

        fireEvent.change(screen.getByPlaceholderText(/key unik/i), { target: { name: 'key', value: 'coba' } });
        fireEvent.change(screen.getByPlaceholderText('Nama paket'), { target: { name: 'name', value: 'Coba' } });
        fireEvent.change(screen.getByLabelText(/Tambahan harga bila kamera merekam/i), { target: { name: 'recording_price_per_camera', value: '9000' } });

        // Operator changes their mind and ticks "trial" afterwards.
        fireEvent.click(screen.getByLabelText(/Paket trial/i));
        fireEvent.change(screen.getByLabelText(/Durasi trial/i), { target: { name: 'trial_days', value: '7' } });

        fireEvent.click(screen.getByText('Simpan'));

        await waitFor(() => expect(billingAdminService.createPlan).toHaveBeenCalled());
        expect(billingAdminService.createPlan.mock.calls[0][0].recording_price_per_camera).toBe(0);
    });

    it('loads the existing surcharge into the edit form and sends it back unchanged', async () => {
        renderTab();
        // Bisnis is the third row's Edit button.
        fireEvent.click(screen.getAllByText('Edit')[2]);

        expect(screen.getByLabelText(/Tambahan harga bila kamera merekam/i).value).toBe('12000');

        fireEvent.click(screen.getByText('Simpan'));

        await waitFor(() => expect(billingAdminService.updatePlan).toHaveBeenCalled());
        const [planId, payload] = billingAdminService.updatePlan.mock.calls[0];
        expect(planId).toBe(3);
        expect(payload.recording_price_per_camera).toBe(12000);
    });

    it('sends sort_order so the catalog order is settable from the panel', async () => {
        renderTab();
        fireEvent.click(screen.getAllByText('Edit')[1]);

        fireEvent.change(screen.getByLabelText(/Urutan tampil/i), { target: { name: 'sort_order', value: '5' } });
        fireEvent.click(screen.getByText('Simpan'));

        await waitFor(() => expect(billingAdminService.updatePlan).toHaveBeenCalled());
        expect(billingAdminService.updatePlan.mock.calls[0][1].sort_order).toBe(5);
    });

    it('treats a cleared surcharge field as zero rather than NaN', async () => {
        renderTab();
        fireEvent.click(screen.getAllByText('Edit')[2]);

        fireEvent.change(screen.getByLabelText(/Tambahan harga bila kamera merekam/i), { target: { name: 'recording_price_per_camera', value: '' } });
        fireEvent.click(screen.getByText('Simpan'));

        await waitFor(() => expect(billingAdminService.updatePlan).toHaveBeenCalled());
        expect(billingAdminService.updatePlan.mock.calls[0][1].recording_price_per_camera).toBe(0);
    });
});
