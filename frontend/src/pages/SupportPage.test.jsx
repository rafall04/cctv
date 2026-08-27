/*
 * Purpose: Kunci janji halaman /dukungan — angkanya hidup, dan tidak ada tombol yang menuju
 *          ke mana-mana.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Halaman ini adalah jalur penjualan, dan dua cara paling mudah merusaknya keduanya SENYAP:
 *
 *   · angka yang ditulis di dalam berkas. Benar hari ini, berbohong tiga bulan lagi, dan tidak
 *     ada yang memeriksa teks statis. Tes di bawah menuntut angkanya berasal dari layanan;
 *   · tombol kontak yang dirender walaupun nomornya belum diisi. Di produksi nomornya MEMANG
 *     belum ada, jadi ini bukan kemungkinan teoretis — ia keadaan hari ini. Tombol yang tidak
 *     menuju ke mana-mana mengajari pengunjung bahwa tombol di situs ini tidak melakukan apa-apa,
 *     yang persis pelajaran yang sudah diberikan banner promo: 1.402 tayangan, 0 klik, karena
 *     tombolnya tidak pernah dirender.
 */

// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPublicReach } = vi.hoisted(() => ({ getPublicReach: vi.fn() }));
vi.mock('../services/supportService', () => ({ getPublicReach, default: { getPublicReach } }));

const { branding } = vi.hoisted(() => ({ branding: { nilai: {} } }));
vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({ branding: branding.nilai, loading: false }),
}));

vi.mock('../components/landing/SponsorStrip', () => ({
    default: () => <div data-testid="sponsor-strip" />,
}));

const { default: SupportPage } = await import('./SupportPage.jsx');

const JANGKAUAN = { window_days: 30, sessions: 2924, cameras: 1114, areas: 18 };
const tampil = () => render(<MemoryRouter><SupportPage /></MemoryRouter>);

beforeEach(() => {
    getPublicReach.mockReset();
    getPublicReach.mockResolvedValue(JANGKAUAN);
    branding.nilai = { company_name: 'RAF' };
});

describe('angkanya hidup, tidak pernah dikeraskan', () => {
    it('menampilkan angka yang DIBERIKAN layanan, bukan angka bawaan', async () => {
        getPublicReach.mockResolvedValue({ ...JANGKAUAN, sessions: 7777, cameras: 42, areas: 3 });

        tampil();

        expect(await screen.findByText('7.777')).toBeTruthy();
        expect(screen.getByText('42')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
    });

    it('menyebut jendela yang diberikan layanan, bukan "30 hari" yang diketik di halaman', async () => {
        getPublicReach.mockResolvedValue({ ...JANGKAUAN, window_days: 7 });

        tampil();

        expect(await screen.findByText(/tontonan \/ 7 hari/)).toBeTruthy();
    });

    it('memisah ribuan supaya 2924 tidak terbaca 292', async () => {
        tampil();

        expect(await screen.findByText('2.924')).toBeTruthy();
    });

    it('angka yang gagal dibaca membuat bloknya HILANG, bukan menampilkan nol', async () => {
        getPublicReach.mockResolvedValue(null);

        const { container } = tampil();

        await waitFor(() => expect(getPublicReach).toHaveBeenCalled());
        expect(container.querySelector('[aria-label="Jangkauan"]')).toBeNull();
    });

    it('nol sungguhan juga disembunyikan - ia berarti "belum ada yang bisa ditunjukkan"', async () => {
        getPublicReach.mockResolvedValue({ window_days: 30, sessions: 0, cameras: 0, areas: 0 });

        const { container } = tampil();

        await waitFor(() => expect(getPublicReach).toHaveBeenCalled());
        expect(container.querySelector('[aria-label="Jangkauan"]')).toBeNull();
    });

    it('halamannya tetap utuh tanpa angka - isinya bukan angka', async () => {
        getPublicReach.mockResolvedValue(null);

        tampil();

        expect(await screen.findByText('Distributor CCTV')).toBeTruthy();
        expect(screen.getByText('Sponsor Lokal')).toBeTruthy();
    });
});

describe('tidak ada tombol yang menuju ke mana-mana', () => {
    it('TANPA nomor WhatsApp, blok kontaknya tidak dirender sama sekali', () => {
        branding.nilai = { company_name: 'RAF' };

        tampil();

        expect(screen.queryByText('Tertarik?'), 'ajakan tanpa cara menghubungi').toBeNull();
        expect(screen.queryByRole('link', { name: /WhatsApp/i })).toBeNull();
    });

    it('DENGAN nomor, tombolnya menuju wa.me dengan kode negara', async () => {
        branding.nilai = { company_name: 'RAF', whatsapp_number: '081234567890' };

        tampil();

        const tautan = await screen.findByRole('link', { name: /WhatsApp/i });
        expect(tautan.getAttribute('href')).toContain('https://wa.me/6281234567890');
    });

    it('nomor yang sudah berformat +62 tidak digandakan kodenya', async () => {
        branding.nilai = { company_name: 'RAF', whatsapp_number: '+62 812-3456-7890' };

        tampil();

        const tautan = await screen.findByRole('link', { name: /WhatsApp/i });
        expect(tautan.getAttribute('href')).toContain('wa.me/6281234567890');
        expect(tautan.getAttribute('href')).not.toContain('wa.me/6262');
    });

    it('tautan keluar dibuka aman', async () => {
        branding.nilai = { company_name: 'RAF', whatsapp_number: '081234567890' };

        tampil();

        const tautan = await screen.findByRole('link', { name: /WhatsApp/i });
        expect(tautan.getAttribute('rel')).toContain('noopener');
    });
});

describe('kerangka halaman', () => {
    it('selalu menyediakan jalan pulang ke beranda', () => {
        tampil();

        expect(screen.getByRole('link', { name: /Beranda/i }).getAttribute('href')).toBe('/');
    });

    it('memuat strip sponsor - janji "logo Anda tampil" berlaku di halaman ini juga', () => {
        tampil();

        expect(screen.getByTestId('sponsor-strip')).toBeTruthy();
    });

    it('memakai nama perusahaan dari branding, bukan nama yang diketik di halaman', () => {
        branding.nilai = { company_name: 'NAMA LAIN' };

        tampil();

        expect(screen.getByText(/Dukung NAMA LAIN CCTV/)).toBeTruthy();
    });
});
