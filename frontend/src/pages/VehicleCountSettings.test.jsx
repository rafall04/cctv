// @vitest-environment jsdom

/*
 * Purpose: Prove the counting-settings page sends exactly the fields the route schema accepts.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked admin service + notification context.
 * SideEffects: jsdom render only.
 *
 * Jebakan yang dijaga: Fastify MENGHAPUS field yang tidak terdaftar di skema, lalu tetap
 * menjawab 200. Jadi setelan yang namanya meleset akan hilang tanpa pesan galat dan panel
 * terlihat "tidak menyimpan". Tes ini memastikan payload-nya persis, bukan sekadar terkirim.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VehicleCountSettings from './VehicleCountSettings';
import vehicleCountAdminService from '../services/vehicleCountAdminService';

vi.mock('../services/vehicleCountAdminService', () => ({
    default: {
        listCameras: vi.fn(),
        listAvailable: vi.fn(),
        getCamera: vi.fn(),
        saveCamera: vi.fn(),
        removeCamera: vi.fn(),
    },
}));

const showNotification = vi.fn();
vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ showNotification }),
}));

const CONFIG = {
    camera_id: 15,
    aktif: true,
    label: 'SOSRODILOGO',
    garis: [{ a: [0.1, 0.2], b: [0.8, 0.9], nama: 'Garis 1' }],
    arah_arus: [0.9, -0.44],
    nama_arah: { plus: 'Ke barat', minus: 'Ke timur' },
    model: 'kamera15-v1.pt',
    imgsz: 448,
    conf: 0.1,
    conf_gambar: 0.35,
    fps: 8,
    min_gerak: 45,
    min_umur: 3,
    berjalan: true,
    umurDetik: 2,
    nama_kamera: 'SOSRODILOGO',
    diperbarui: '2026-08-13T06:00:00Z',
};

beforeEach(() => {
    vi.clearAllMocks();
    vehicleCountAdminService.listCameras.mockResolvedValue({
        data: [{ ...CONFIG, nama_kamera: 'SOSRODILOGO' }],
    });
    vehicleCountAdminService.listAvailable.mockResolvedValue({ data: [] });
    vehicleCountAdminService.getCamera.mockResolvedValue({ data: CONFIG });
    vehicleCountAdminService.saveCamera.mockResolvedValue({ data: CONFIG, message: 'ok' });
});

describe('VehicleCountSettings', () => {
    it('menampilkan kamera yang sudah diatur beserta status jalannya', async () => {
        render(<VehicleCountSettings />);
        expect(await screen.findByText('SOSRODILOGO')).toBeTruthy();
        expect(screen.getByText(/menghitung/)).toBeTruthy();
    });

    it('mengirim tepat field yang diterima skema rute — tidak lebih, tidak kurang', async () => {
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));
        fireEvent.click(await screen.findByText('Simpan setelan'));

        await waitFor(() => expect(vehicleCountAdminService.saveCamera).toHaveBeenCalled());
        const [id, payload] = vehicleCountAdminService.saveCamera.mock.calls[0];

        expect(id).toBe(15);
        expect(Object.keys(payload).sort()).toEqual([
            'aktif', 'arah_arus', 'conf', 'conf_gambar', 'fps', 'garis',
            'imgsz', 'label', 'min_gerak', 'min_umur', 'model', 'nama_arah',
        ]);
        // field turunan server tidak boleh ikut terkirim
        expect(payload).not.toHaveProperty('berjalan');
        expect(payload).not.toHaveProperty('camera_id');
        expect(payload).not.toHaveProperty('diperbarui');
    });

    it('menyampaikan alasan penolakan server apa adanya', async () => {
        vehicleCountAdminService.saveCamera.mockRejectedValue({
            response: { data: { message: 'Gambar dulu minimal satu garis hitung sebelum menyalakan' } },
        });
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));
        fireEvent.click(await screen.findByText('Simpan setelan'));

        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
            expect.stringMatching(/minimal satu garis/i), 'error',
        ));
    });
});
