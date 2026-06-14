// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    setAreaGated: vi.fn(),
    getProfiles: vi.fn(),
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    generateCodes: vi.fn(),
    getCodes: vi.fn(),
    revokeCode: vi.fn(),
}));

// Stable singletons — returning a fresh object/fn each render would change notifyError's identity,
// re-create the loadData useCallback, and re-fire its useEffect every render (infinite reload loop).
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const confirmFn = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock('../services/voucherAdminService', () => ({ default: svc }));
vi.mock('../services/areaService', () => ({ areaService: { getAllAreas: vi.fn() } }));
vi.mock('../contexts/NotificationContext', () => ({ useNotification: () => notify }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }));

import { areaService } from '../services/areaService';
import VoucherManagement from './VoucherManagement';

describe('VoucherManagement', () => {
    beforeEach(() => {
        svc.getSettings.mockResolvedValue({ success: true, data: { enabled: false, gated_area_ids: [1] } });
        areaService.getAllAreas.mockResolvedValue({ success: true, data: [
            { id: 1, name: 'Dander', rw: '01' },
            { id: 2, name: 'Sumber' },
        ] });
        svc.getProfiles.mockResolvedValue({ success: true, data: [
            { id: 3, name: 'RW Dander 1 Hari', duration_minutes: 1440, price: 10000, max_uses_per_code: 1, online_purchasable: 1, active: 1, area_ids: [1] },
        ] });
        svc.getCodes.mockResolvedValue({ success: true, data: [
            { id: 7, code: 'ABCD-EFGH', profile_id: 3, status: 'unused', redeemed_count: 0 },
        ] });
    });

    afterEach(cleanup);

    it('renders the flag, gated area, profile (formatted) and code', async () => {
        render(<VoucherManagement />);
        await screen.findByText('ABCD-EFGH');
        expect(screen.getAllByText('RW Dander 1 Hari').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/Fitur non-aktif/)).toBeTruthy();
        expect(screen.getByText('🔒 Berbayar')).toBeTruthy();   // area 1 gated
        expect(screen.getByText('1 hari')).toBeTruthy();          // duration formatted
        expect(screen.getByText('Rp 10.000')).toBeTruthy();       // price formatted
    });

    it('toggles the global flag on', async () => {
        svc.updateSettings.mockResolvedValue({ success: true, data: { enabled: true, gated_area_ids: [1] } });
        render(<VoucherManagement />);
        fireEvent.click(await screen.findByText(/Fitur non-aktif/));
        await waitFor(() => expect(svc.updateSettings).toHaveBeenCalledWith(true));
    });

    it('marks an ungated area as berbayar', async () => {
        svc.setAreaGated.mockResolvedValue({ success: true, data: { area_id: 2, is_access_gated: 1 } });
        render(<VoucherManagement />);
        fireEvent.click(await screen.findByText('Gratis')); // area 2 (Sumber) is not gated
        await waitFor(() => expect(svc.setAreaGated).toHaveBeenCalledWith(2, true));
    });

    it('generates codes from a profile and shows them', async () => {
        svc.generateCodes.mockResolvedValue({ success: true, data: [{ id: 11, code: 'WXYZ-1234' }] });
        render(<VoucherManagement />);
        fireEvent.click(await screen.findByText('Generate'));
        fireEvent.click(await screen.findByText('Buat Kode'));
        await waitFor(() => expect(svc.generateCodes).toHaveBeenCalledWith(3, expect.objectContaining({ count: 5, source: 'admin' })));
        expect(await screen.findByText('WXYZ-1234')).toBeTruthy();
    });

    it('revokes a code', async () => {
        svc.revokeCode.mockResolvedValue({ success: true, data: { id: 7, status: 'revoked' } });
        render(<VoucherManagement />);
        fireEvent.click(await screen.findByText('Cabut'));
        await waitFor(() => expect(svc.revokeCode).toHaveBeenCalledWith(7));
    });
});
