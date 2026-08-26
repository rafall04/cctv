/*
 * Purpose: Kunci kejujuran halaman jam kamera — terutama saat datanya TIDAK bisa dipercaya.
 * Caller: Vitest frontend.
 * Deps: apiClient & NotificationContext di-mock.
 *
 * KENAPA TES INI FOKUS PADA KEGAGALAN
 * -----------------------------------
 * Kolom yang tampil benar saat semuanya sehat akan langsung terlihat salah oleh siapa pun yang
 * membukanya. Yang tidak terlihat adalah keadaan sebaliknya: panel yang menampilkan angka bagus
 * dari data seminggu lalu, atau dari permintaan yang gagal, terlihat PERSIS SAMA dengan panel
 * yang benar-benar sehat.
 *
 * Itu bentuk kebohongan yang seluruh fitur ini dibuat untuk mengakhiri — lima kamera berhenti di
 * tahun 1970 entah sejak kapan justru karena tidak ada permukaan yang menampilkannya.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraTimeStatus } from './CameraTimeStatus';

const h = vi.hoisted(() => ({
    get: vi.fn(),
    put: vi.fn(),
    showNotification: vi.fn(),
}));

vi.mock('../services/apiClient', () => ({
    default: { get: h.get, put: h.put },
}));
vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ showNotification: h.showNotification }),
}));

const KAMERA_SEHAT = {
    id: 1,
    name: 'CCTV Lapangan',
    hasOnvifCredentials: false,
    checkedAt: '2026-08-26T04:00:00',
    ageMinutes: 5,
    stale: false,
    reachable: true,
    mode: 'NTP',
    driftSeconds: 0,
    method: 'onvif',
    healthy: true,
    note: 'ok',
};

function balas({ cameras, summary }) {
    h.get.mockResolvedValue({ data: { success: true, data: { cameras, summary } } });
}

const RINGKASAN_SEHAT = {
    total: 1, healthy: 1, problems: 0, unreachable: 0, stale: 0,
    lastCheckedAt: '2026-08-26T04:00:00', lastCheckAgeMinutes: 5, syncerEverRan: true,
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('halaman jam kamera menolak terlihat sehat tanpa dasar', () => {
    it('menampilkan kamera yang selaras apa adanya', async () => {
        balas({ cameras: [KAMERA_SEHAT], summary: RINGKASAN_SEHAT });

        render(<CameraTimeStatus />);

        expect(await screen.findByText('CCTV Lapangan')).not.toBeNull();
        expect(screen.getByText('Selaras')).not.toBeNull();
        expect(screen.getByText(/Menarik sendiri dari server/)).not.toBeNull();
    });

    it('menyebut KAPAN pemeriksaan terakhir, bukan hanya berapa yang sehat', async () => {
        /*
         * Tanpa umur pemeriksaan, "1 dari 1 selaras" dari data seminggu lalu terbaca sama
         * meyakinkannya dengan data lima menit lalu.
         */
        balas({ cameras: [KAMERA_SEHAT], summary: RINGKASAN_SEHAT });

        render(<CameraTimeStatus />);

        expect(await screen.findByText(/Diperiksa 5 menit lalu/)).not.toBeNull();
    });

    it('tidak menyebut kamera basi sebagai selaras', async () => {
        balas({
            cameras: [{ ...KAMERA_SEHAT, stale: true, healthy: false, ageMinutes: 4320 }],
            summary: { ...RINGKASAN_SEHAT, healthy: 0, problems: 1, stale: 1, lastCheckAgeMinutes: 4320 },
        });

        render(<CameraTimeStatus />);

        expect(await screen.findByText('Belum diketahui')).not.toBeNull();
        expect(screen.queryByText('Selaras')).toBeNull();
    });

    it('mengatakan penyelarasnya belum pernah jalan, alih-alih menampilkan nol yang menyesatkan', async () => {
        balas({
            cameras: [],
            summary: { total: 0, healthy: 0, problems: 0, unreachable: 0, stale: 0, lastCheckedAt: null, lastCheckAgeMinutes: null, syncerEverRan: false },
        });

        render(<CameraTimeStatus />);

        expect(await screen.findByText(/belum pernah berjalan/i)).not.toBeNull();
        expect(screen.getByText(/setup\.sh/)).not.toBeNull();
    });

    it('menyatakan datanya tidak bisa dipercaya saat permintaan gagal', async () => {
        h.get.mockRejectedValue(new Error('jaringan mati'));

        render(<CameraTimeStatus />);

        expect(await screen.findByText(/tidak bisa dipercaya/i)).not.toBeNull();
        await waitFor(() => expect(h.showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' }),
        ));
    });

    it('membedakan tak terjangkau dari salah — dan tidak membunyikan alarm untuknya', async () => {
        balas({
            cameras: [{
                ...KAMERA_SEHAT, reachable: false, healthy: false, mode: null,
                driftSeconds: null, method: null, note: 'ONVIF tidak menjawab',
            }],
            summary: { ...RINGKASAN_SEHAT, healthy: 0, problems: 1, unreachable: 1 },
        });

        render(<CameraTimeStatus />);

        expect(await screen.findByText('Tak terjangkau')).not.toBeNull();
        expect(screen.getByText(/belum tentu jamnya salah/i)).not.toBeNull();
    });
});

describe('kredensial ONVIF darurat', () => {
    async function bukaDialog() {
        balas({ cameras: [KAMERA_SEHAT], summary: RINGKASAN_SEHAT });
        render(<CameraTimeStatus />);
        fireEvent.click(await screen.findByRole('button', { name: 'Akun ONVIF' }));
        return screen.getByRole('dialog');
    }

    it('mengatakan kolomnya biasanya TIDAK perlu diisi', async () => {
        const dialog = await bukaDialog();

        expect(within(dialog).getByText(/biasanya kolom ini tidak perlu diisi/i)).not.toBeNull();
    });

    /*
     * Sandi tersimpan tidak pernah dikirim balik ke panel, jadi kolomnya selalu mulai kosong.
     * Kalau halaman tidak MENGATAKAN bahwa menyimpan dalam keadaan kosong berarti menghapus,
     * operator yang hanya ingin mengubah nama pengguna akan menghapus sandinya tanpa sadar.
     */
    it('memperingatkan bahwa menyimpan dalam keadaan kosong akan menghapus akun khusus', async () => {
        const dialog = await bukaDialog();

        expect(within(dialog).getByText(/kedua kolom kosong akan menghapus/i)).not.toBeNull();
    });

    it('mengirim nilainya ke kamera yang benar, lalu memuat ulang', async () => {
        h.put.mockResolvedValue({ data: { success: true, message: 'Kredensial ONVIF khusus disimpan' } });
        const dialog = await bukaDialog();

        fireEvent.change(within(dialog).getByLabelText(/Nama pengguna ONVIF/i), { target: { value: 'onvifuser' } });
        fireEvent.change(within(dialog).getByLabelText(/Sandi ONVIF/i), { target: { value: 'rahasia' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));

        await waitFor(() => expect(h.put).toHaveBeenCalledWith(
            '/api/admin/camera-time/1/onvif-credentials',
            { username: 'onvifuser', password: 'rahasia' },
        ));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(h.get).toHaveBeenCalledTimes(2);
    });

    it('mempertahankan dialog ketika penyimpanan ditolak', async () => {
        h.put.mockRejectedValue({ response: { data: { message: 'Camera not found' } } });
        const dialog = await bukaDialog();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));

        await waitFor(() => expect(h.showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' }),
        ));
        expect(screen.queryByRole('dialog')).not.toBeNull();
    });
});
