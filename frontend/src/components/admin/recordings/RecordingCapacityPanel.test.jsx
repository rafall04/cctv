// @vitest-environment jsdom

/*
 * Purpose: Prove the panel answers "will this retention fit?" with real arithmetic, including the
 *          grace period and the emergency reserve an operator would otherwise count as free.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked adminService.
 * SideEffects: jsdom render only.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordingCapacityPanel from './RecordingCapacityPanel';
import { adminService } from '../../../services/adminService';

vi.mock('../../../services/adminService', () => ({
    adminService: { getRecordingCapacity: vi.fn() },
}));

const GB = 1024 * 1024 * 1024;

/** Two cameras at 1 GB/camera-hour with 100 GB of usable room. */
const CAPACITY = {
    cameras: 2,
    retention: { currentHours: 4, minHours: 4, maxHours: 4, mixed: false },
    rate: { bytesPerCameraHour: GB, source: 'measured', sampleCameras: 2, sampleHours: 8 },
    disk: {
        freeBytes: 95 * GB, usedByRecordingsBytes: 9 * GB,
        reservedBytes: 4 * GB, safeBytes: 100 * GB, basePath: '/var/recordings',
    },
    projections: [
        { hours: 4, effectiveHours: 4.4, bytes: 8.8 * GB, fits: true, isCurrent: true },
        { hours: 72, effectiveHours: 79.2, bytes: 158.4 * GB, fits: false, isCurrent: false },
    ],
};

beforeEach(() => {
    vi.clearAllMocks();
    adminService.getRecordingCapacity.mockResolvedValue({ success: true, data: CAPACITY });
});

describe('RecordingCapacityPanel', () => {
    it('says where the rate came from instead of presenting it as a given', async () => {
        render(<RecordingCapacityPanel />);

        expect(await screen.findByText(/Diukur dari rekaman sendiri: 1.00 GB per kamera per jam/)).toBeTruthy();
    });

    it('names the reference figure when this install has not measured its own yet', async () => {
        adminService.getRecordingCapacity.mockResolvedValue({
            success: true,
            data: { ...CAPACITY, rate: { ...CAPACITY.rate, source: 'default', bytesPerCameraHour: 0.43 * GB } },
        });
        render(<RecordingCapacityPanel />);

        expect(await screen.findByText(/Belum cukup data rekaman di sini/)).toBeTruthy();
    });

    /* The reserve is not spare room — crossing it triggers bulk deletion of footage. */
    it('separates the emergency reserve from what can actually be planned with', async () => {
        render(<RecordingCapacityPanel />);
        await screen.findByText('Cadangan darurat');

        const value = (label) => screen.getByText(label).nextElementSibling.textContent;
        expect(value('Cadangan darurat')).toBe('4.0 GB');
        expect(value('Bisa dipakai')).toBe('100.0 GB');
        expect(value('Sisa disk')).toBe('95.0 GB');
    });

    it('starts on the retention the fleet is actually set to', async () => {
        render(<RecordingCapacityPanel />);

        expect((await screen.findByLabelText('Coba retensi (jam)')).value).toBe('4');
        expect(screen.getByText('Setelan sekarang')).toBeTruthy();
    });

    /** 24 h + 2.4 h grace = 26.4 effective hours x 2 cameras x 1 GB = 52.8 GB, leaving 47.2 GB. */
    it('recomputes for a retention the operator is considering, grace included', async () => {
        render(<RecordingCapacityPanel />);
        const input = await screen.findByLabelText('Coba retensi (jam)');

        fireEvent.change(input, { target: { value: '24' } });

        await waitFor(() => expect(screen.getByText(/52.8 GB/)).toBeTruthy());
        expect(screen.getByText(/termasuk masa tenggang sampai 26.4 jam/)).toBeTruthy();
        expect(screen.getByText(/Muat, sisa 47.2 GB/)).toBeTruthy();
    });

    it('says how far short an over-ambitious retention falls', async () => {
        render(<RecordingCapacityPanel />);
        const input = await screen.findByLabelText('Coba retensi (jam)');

        // 168 h + 16.8 grace = 184.8 x 2 = 369.6 GB against 100 GB usable.
        fireEvent.change(input, { target: { value: '168' } });

        await waitFor(() => expect(screen.getByText(/Kurang 269.6 GB/)).toBeTruthy());
    });

    /** An unreadable disk is "we do not know", never a confident "it fits". */
    it('refuses to claim a fit when free space could not be read', async () => {
        adminService.getRecordingCapacity.mockResolvedValue({
            success: true,
            data: {
                ...CAPACITY,
                disk: { ...CAPACITY.disk, freeBytes: null, safeBytes: null },
                projections: CAPACITY.projections.map((p) => ({ ...p, fits: null })),
            },
        });
        render(<RecordingCapacityPanel />);

        expect(await screen.findByText(/kecukupannya belum bisa dipastikan/)).toBeTruthy();
        expect(screen.getAllByText('Belum diketahui').length).toBe(2);
    });

    it('renders nothing when the projection cannot be loaded', async () => {
        adminService.getRecordingCapacity.mockResolvedValue({ success: false, message: 'Sesi habis' });
        const { container } = render(<RecordingCapacityPanel />);

        await waitFor(() => expect(adminService.getRecordingCapacity).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });
});
