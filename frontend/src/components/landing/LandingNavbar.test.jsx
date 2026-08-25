/*
 * Purpose: Regression test for public landing navbar layout, label removal, and router-safe navigation.
 * Caller: Frontend Vitest suite for public landing components.
 * Deps: React Testing Library, Vitest, LandingNavbar, router and theme/camera mocks.
 * MainFuncs: Verifies navbar rendering and layout toggle behavior.
 * SideEffects: Mocks context providers and router rendering during test execution.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LandingNavbar from './LandingNavbar';

vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({
        isDark: false,
        toggleTheme: vi.fn(),
    }),
}));

const cameraContextState = {
    cameras: [{ id: 1, status: 'active', is_online: 1 }],
    loading: false,
    dataUnavailable: false,
};

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({
        cameras: cameraContextState.cameras,
        loading: cameraContextState.loading,
        dataUnavailable: cameraContextState.dataUnavailable,
    }),
}));

vi.mock('../../utils/animationControl', () => ({
    shouldDisableAnimations: () => true,
}));

const branding = {
    company_name: 'RAF NET',
    company_tagline: 'Internet & CCTV',
    city_name: 'Pekalongan',
    logo_text: 'R',
};

describe('LandingNavbar', () => {
    it('menampilkan toggle layout berbasis teks dan menghapus label publik', () => {
        const onLayoutToggle = vi.fn();

        render(
            <MemoryRouter>
                <LandingNavbar
                    branding={branding}
                    layoutMode="full"
                    onLayoutToggle={onLayoutToggle}
                />
            </MemoryRouter>
        );

        expect(screen.getByTitle('Internet & CCTV - RAF NET').getAttribute('href')).toBe('/');
        expect(screen.getByRole('tab', { name: /full/i })).not.toBeNull();
        expect(screen.getByRole('tab', { name: /simple/i })).not.toBeNull();
        expect(screen.queryByText('Publik')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: /simple/i }));
        expect(onLayoutToggle).toHaveBeenCalledTimes(1);
    });

    // Outage honesty: a green pulse next to "0" told visitors the network was healthy and empty.
    it('tidak menyatakan angka nol dan tidak menyalakan titik hijau saat data gagal diambil', () => {
        cameraContextState.cameras = [];
        cameraContextState.dataUnavailable = true;

        render(
            <MemoryRouter>
                <LandingNavbar branding={branding} layoutMode="full" onLayoutToggle={vi.fn()} />
            </MemoryRouter>
        );

        expect(screen.queryAllByText('0')).toHaveLength(0);
        expect(screen.getByText('…')).toBeTruthy();
        expect(screen.getByText('Tak terhubung')).toBeTruthy();
        expect(screen.queryByText('Online')).toBeNull();
        expect([...document.querySelectorAll('[class*="status-live"]')]).toHaveLength(0);

        cameraContextState.cameras = [{ id: 1, status: 'active', is_online: 1 }];
        cameraContextState.dataUnavailable = false;
    });
    /*
     * Halaman jualan adalah HTML STATIS (frontend/public/sewa/), dan App.jsx:147 mencatat bahwa
     * ketiadaan rute SPA untuknya memang disengaja. Konsekuensinya tombol ini TIDAK boleh berupa
     * <Link>: navigasi sisi-klien tidak menemukan rute, lalu catch-all App.jsx:455 memantulkannya
     * ke "/". Tombolnya tampak berfungsi dan tidak pernah membuka apa pun — satu-satunya jalur
     * penjualan di permukaan publik mati tanpa suara.
     *
     * Diuji lewat DOM, bukan lewat nama komponen, karena yang menentukan memang atribut yang
     * dihasilkan: <Link to="/x"> juga merender <a href="/x">, yang membedakannya adalah react-
     * router memasang penangan klik di atasnya. Karena itu yang dikunci adalah bentuk href-nya —
     * termasuk garis miring akhir, sebab "/sewa" memicu 301 nginx yang membocorkan port internal
     * (:800) dan menggantung dari luar.
     */
    it('membuka halaman jualan lewat navigasi dokumen penuh, bukan rute SPA', () => {
        render(
            <MemoryRouter>
                <LandingNavbar branding={branding} layoutMode="full" onLayoutToggle={vi.fn()} />
            </MemoryRouter>
        );

        const sewa = screen.getByRole('link', { name: 'Sewa' });
        expect(sewa.getAttribute('href')).toBe('/sewa/');

        /*
         * Href saja TIDAK cukup, dan itu jerat yang nyaris saya tinggalkan di sini: <Link
         * to="/sewa/"> merender <a href="/sewa/"> yang identik, jadi asersi href di atas akan
         * tetap hijau sementara bug-nya kembali utuh.
         *
         * Yang benar-benar membedakan adalah PERILAKU KLIK: react-router memanggil
         * preventDefault() pada navigasi internal supaya browser tidak memuat ulang dokumen.
         * Sebuah <a> polos membiarkannya. Jadi itulah yang diperiksa.
         */
        const klik = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        sewa.dispatchEvent(klik);
        expect(klik.defaultPrevented).toBe(false);
    });
});
