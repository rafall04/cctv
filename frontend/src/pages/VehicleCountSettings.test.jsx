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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        getSummary: vi.fn(),
    },
}));

const showNotification = vi.fn();
vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ showNotification }),
}));

/*
 * Menghapus detektor dulu TIDAK bertanya apa-apa — satu-satunya aksi merusak di seluruh
 * permukaan admin yang begitu, dan tombolnya duduk di antara "Simpan setelan" dan "Tutup".
 * Mock ini bisa dikemudikan per-tes supaya jalur BATAL benar-benar teruji; mock yang selalu
 * menjawab "ya" akan membuat konfirmasinya lolos tanpa pernah dijalankan.
 */
let jawabanKonfirmasi = true;
vi.mock('../contexts/ConfirmContext', () => ({
    useConfirm: () => () => Promise.resolve(jawabanKonfirmasi),
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
    jawabanKonfirmasi = true;
    vehicleCountAdminService.listCameras.mockResolvedValue({
        data: [{ ...CONFIG, nama_kamera: 'SOSRODILOGO' }],
    });
    vehicleCountAdminService.listAvailable.mockResolvedValue({ data: [] });
    vehicleCountAdminService.getCamera.mockResolvedValue({ data: CONFIG });
    vehicleCountAdminService.saveCamera.mockResolvedValue({ data: CONFIG, message: 'ok' });
    vehicleCountAdminService.getSummary.mockResolvedValue({
        data: {
            total: 2254, total_10_menit: 374,
            total_jenis: { motor: 1280, mobil: 521, truk: 443, bus: 10 },
            arah: { 'Ke barat': { motor: 700 }, 'Ke timur': { motor: 580 } },
            fps: 10.3, frame_diproses: 12000, umur_frame_terakhir_detik: 0.9,
            frame_dijatuhkan_sumber: 52, sambung_ulang: 0, setelan_dimuat_ulang: 2,
            jumlah_garis: 3, model: 'kamera15-v1.pt imgsz=448',
            diperbarui: '2026-08-13 13:40:00 WIB', mulai: '2026-08-13 10:46:38 WIB',
        },
    });
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
        fireEvent.click(await screen.findByText('Ubah setelan'));
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

    /*
     * Data hitungan harus ikut terangkum di panel admin: yang pertama ingin diketahui admin
     * setelah membuka kamera adalah apakah ini benar-benar menghitung dan berapa — bukan
     * formulir setelannya.
     */
    it('merangkum data hitungan beserta angka kesehatan prosesnya', async () => {
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));

        expect(await screen.findByText('374')).toBeTruthy();               // 10 menit terakhir
        // angka & keterangannya berada di elemen terpisah, jadi dicocokkan masing-masing
        expect(screen.getByText('2.254')).toBeTruthy();                    // total sesi
        expect(screen.getByText(/total sejak/)).toBeTruthy();
        expect(screen.getByText('1.280')).toBeTruthy();                    // motor
        expect(screen.getByText(/10.3 fps/)).toBeTruthy();                 // angka operasional
        expect(screen.getByText(/setelan dimuat ulang 2×/)).toBeTruthy();
    });

    it('mengatakan apa adanya saat kamera belum pernah menghitung', async () => {
        vehicleCountAdminService.getSummary.mockResolvedValue({ data: null });
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));

        expect(await screen.findByText(/Belum ada data hitungan/i)).toBeTruthy();
    });

    it('menyampaikan alasan penolakan server apa adanya', async () => {
        vehicleCountAdminService.saveCamera.mockRejectedValue({
            response: { data: { message: 'Gambar dulu minimal satu garis hitung sebelum menyalakan' } },
        });
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));
        fireEvent.click(await screen.findByText('Ubah setelan'));
        fireEvent.click(await screen.findByText('Simpan setelan'));

        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
            expect.stringMatching(/minimal satu garis/i), 'error',
        ));
    });

    /*
     * Formulirnya kini ui/Modal. Dua hal yang dijaga sekaligus:
     *  - setelannya benar-benar berada DI DALAM dialog (kalau suatu saat kembali menjadi formulir
     *    inline, pengukuran overflow e2e untuk halaman ini akan diam-diam kehilangan sasarannya);
     *  - "Hapus dari daftar" TIDAK ikut masuk ke dialog. ConfirmDialog memasang jerat fokusnya
     *    sendiri, dan dua jerat yang hidup bersamaan saling merebut Tab.
     */
    it('menaruh setelan di dalam dialog, dan tombol hapus tetap di luar', async () => {
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));

        expect(screen.queryByRole('dialog')).toBeNull();          // memilih ≠ mengedit
        expect(screen.getByText('Hapus dari daftar')).toBeTruthy();

        fireEvent.click(screen.getByText('Ubah setelan'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Simpan setelan')).toBeTruthy();
        expect(within(dialog).getByText('Nyalakan penghitungan')).toBeTruthy();
        expect(within(dialog).queryByText('Hapus dari daftar')).toBeNull();
    });

    /*
     * `ubah()` menulis langsung ke draft, dan panel di halaman membaca draft itu juga — jadi
     * "Batal" yang cuma menutup dialog akan meninggalkan centang yang TIDAK tersimpan tampil di
     * halaman seolah sudah berlaku. Batal harus memuat ulang keadaan yang benar-benar tersimpan.
     */
    it('membatalkan membuang perubahan yang belum disimpan, bukan sekadar menutup', async () => {
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));
        fireEvent.click(await screen.findByText('Ubah setelan'));

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByLabelText('Nyalakan penghitungan'));
        expect(await screen.findByText('penghitungan dimatikan')).toBeTruthy();

        fireEvent.click(within(dialog).getByText('Batal'));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        // ...dan panel kembali menyebut keadaan yang tersimpan di server, bukan centang tadi.
        expect(await screen.findByText('penghitungan dinyalakan')).toBeTruthy();
        expect(vehicleCountAdminService.saveCamera).not.toHaveBeenCalled();
    });

    it('menutup dialog setelah tersimpan, supaya angka hitungannya terlihat lagi', async () => {
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));
        fireEvent.click(await screen.findByText('Ubah setelan'));
        fireEvent.click(await screen.findByText('Simpan setelan'));

        await waitFor(() => expect(vehicleCountAdminService.saveCamera).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    /*
     * REGRESI (audit keseragaman admin, 2026-08-22): ini dulu satu-satunya aksi merusak di
     * seluruh permukaan admin yang langsung jalan tanpa bertanya — satu salah pencet membuang
     * garis hitung, arah arus, model dan seluruh ambang yang disetel manual, tanpa jalan kembali.
     * Sejak formulirnya pindah ke ui/Modal, tombolnya duduk di panel kamera (di luar dialog) dan
     * memakai varian dangerGhost, tetapi konfirmasinya tetap yang menahan salah pencet.
     *
     * Dua arah diuji dengan sengaja. Mock yang selalu menjawab "ya" akan membiarkan konfirmasinya
     * dihapus lagi tanpa ada tes yang merah.
     */
    it('tidak menghapus apa pun kalau operator membatalkan', async () => {
        jawabanKonfirmasi = false;
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));
        fireEvent.click(await screen.findByText('Hapus dari daftar'));

        await waitFor(() => expect(vehicleCountAdminService.getCamera).toHaveBeenCalled());
        expect(vehicleCountAdminService.removeCamera).not.toHaveBeenCalled();
    });

    it('menghapus setelah operator menyetujui', async () => {
        jawabanKonfirmasi = true;
        vehicleCountAdminService.removeCamera.mockResolvedValue({ success: true });
        render(<VehicleCountSettings />);
        fireEvent.click(await screen.findByText('SOSRODILOGO'));
        fireEvent.click(await screen.findByText('Hapus dari daftar'));

        await waitFor(() => expect(vehicleCountAdminService.removeCamera).toHaveBeenCalled());
    });
});
