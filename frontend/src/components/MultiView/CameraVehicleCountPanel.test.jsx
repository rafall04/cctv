// @vitest-environment jsdom

/*
 * Purpose: Prove the public vehicle-count panel shows real numbers for the one camera that has
 *          them, stays silent everywhere else, and never passes stale counts off as live.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked vehicleCountService.
 * SideEffects: jsdom render only.
 *
 * The silence case matters most: this sits under the video on EVERY public camera popup, so a
 * panel that rendered an empty shell for the other 35 cameras would be permanent dead space.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraVehicleCountPanel from './CameraVehicleCountPanel';
import { vehicleCountService } from '../../services/vehicleCountService';

vi.mock('../../services/vehicleCountService', () => ({
    vehicleCountService: { getForCamera: vi.fn() },
}));

const DATA = {
    cameraId: 15,
    namaKamera: 'PEREMPATAN JEMBATAN SOSRODILOGO',
    tersedia: true,
    berhenti: false,
    umurDetik: 3,
    mulaiTeks: '2026-08-12 20:57:33 WIB',
    total: 1284,
    total10m: 37,
    perJenis10m: { motor: 24, mobil: 11, truk: 2, bus: 0 },
    perJenis: { motor: 812, mobil: 390, truk: 68, bus: 14 },
    perArah: [
        { label: 'Menuju timur (belakang kamera)', total: 658, perJenis: {} },
        { label: 'Menuju barat (jembatan)', total: 626, perJenis: {} },
    ],
    perMenit: [
        { menit: '07:01', total: 22 },
        { menit: '07:02', total: 17 },
        { menit: '07:03', total: 31 },
    ],
};

beforeEach(() => {
    vi.clearAllMocks();
    vehicleCountService.getForCamera.mockResolvedValue({ success: true, data: DATA });
});

describe('CameraVehicleCountPanel', () => {
    it('shows the total, the per-type breakdown and each direction', async () => {
        render(<CameraVehicleCountPanel cameraId={15} />);

        expect(await screen.findByText('1.284')).toBeTruthy();
        expect(screen.getByText('812')).toBeTruthy();
        expect(screen.getByText('390')).toBeTruthy();
        expect(screen.getByText('Menuju barat (jembatan)')).toBeTruthy();
        expect(screen.getByText('658')).toBeTruthy();
    });

    /*
     * The headline has to be the number a visitor can actually check. A session total that
     * has been accumulating for half a day can only be taken on faith; the last ten minutes
     * can be compared against the vehicles they just watched go past.
     */
    it('leads with the ten-minute figure a visitor can verify against the video', async () => {
        render(<CameraVehicleCountPanel cameraId={15} />);

        expect(await screen.findByText('37')).toBeTruthy();
        expect(screen.getByText(/kendaraan dalam 10 menit terakhir/i)).toBeTruthy();
    });

    it('marks the per-type cards as the session breakdown, not the ten-minute one', async () => {
        render(<CameraVehicleCountPanel cameraId={15} />);

        expect(await screen.findByText(/Rincian sejak mulai/i)).toBeTruthy();
        expect(screen.getByText(/total sejak/i)).toBeTruthy();
    });

    it('says what the number counts instead of showing a bare total', async () => {
        render(<CameraVehicleCountPanel cameraId={15} />);

        expect(await screen.findByText(/satu kali per kendaraan/i)).toBeTruthy();
    });

    it('renders nothing for a camera without counting', async () => {
        vehicleCountService.getForCamera.mockResolvedValue({
            success: true,
            data: { cameraId: 16, tersedia: false },
        });
        const { container } = render(<CameraVehicleCountPanel cameraId={16} />);

        await waitFor(() => expect(vehicleCountService.getForCamera).toHaveBeenCalled());
        expect(container.querySelector('[data-testid="camera-vehicle-count-panel"]')).toBeNull();
    });

    it('renders nothing when the endpoint fails, instead of an error on a public page', async () => {
        vehicleCountService.getForCamera.mockRejectedValue(new Error('404'));
        const { container } = render(<CameraVehicleCountPanel cameraId={15} />);

        await waitFor(() => expect(vehicleCountService.getForCamera).toHaveBeenCalled());
        expect(container.querySelector('[data-testid="camera-vehicle-count-panel"]')).toBeNull();
    });

    it('labels stopped counts as stopped rather than presenting them as current', async () => {
        vehicleCountService.getForCamera.mockResolvedValue({
            success: true,
            data: { ...DATA, berhenti: true, umurDetik: 900 },
        });
        render(<CameraVehicleCountPanel cameraId={15} />);

        expect(await screen.findByText('Berhenti diperbarui')).toBeTruthy();
        expect(screen.getByText(/bukan jumlah saat ini/i)).toBeTruthy();
        expect(screen.getByText(/Penghitungan berhenti diperbarui/i)).toBeTruthy();
    });

    it('does not query anything when no camera is open', () => {
        render(<CameraVehicleCountPanel cameraId={null} />);
        expect(vehicleCountService.getForCamera).not.toHaveBeenCalled();
    });
});
