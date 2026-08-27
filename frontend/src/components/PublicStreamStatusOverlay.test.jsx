/*
 * Purpose: Kunci nada dan tombol panel status pemutar publik.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Komponen ini sebelumnya NOL tes, padahal ia yang menegakkan dua aturan yang mudah dilanggar
 * tanpa suara:
 *
 *   1. Merah (`status-fault`) hanya untuk fault SEJATI. Setiap varian baru yang lupa didaftarkan
 *      jatuh ke `|| 'text-status-fault'`, jadi menambahkannya di publicPopupState.js saja sudah
 *      cukup untuk memerahkan gangguan yang sebenarnya pulih - dan tidak ada yang memberi tahu.
 *      Ini sudah pernah terjadi pada varian 'stalled'.
 *   2. Tombol coba lagi muncul HANYA dan SELALU sesuai `canRetry`. Keluhan pemilik yang memulai
 *      seluruh rangkaian perbaikan ini intinya satu: panel tanpa jalan keluar.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicStreamStatusOverlay from './PublicStreamStatusOverlay.jsx';
import { getPublicPopupOverlayState } from '../utils/publicPopupState.js';

afterEach(cleanup);

const nada = () => document.querySelector('[class*="text-status-"], [class*="text-content-muted"]')?.className || '';

describe('merah hanya untuk fault sejati', () => {
    /*
     * Daftar ini SENGAJA memakai keadaan yang benar-benar bisa dicapai lewat
     * getPublicPopupOverlayState, bukan varian karangan - supaya varian baru yang lupa didaftarkan
     * di VARIANT_TONE memerahkan tes ini, bukan lolos diam-diam.
     */
    const BISA_PULIH = ['codec', 'network', 'media', 'cors', 'stalled'];

    for (const errorType of BISA_PULIH) {
        it(`varian '${errorType}' tidak dicat merah-kegagalan`, () => {
            const state = getPublicPopupOverlayState({ status: 'error', errorType });
            render(<PublicStreamStatusOverlay state={state} />);

            expect(nada(), `${errorType} memakai warna fault`).not.toContain('text-status-fault');
        });
    }

    it("varian 'unknown' MEMANG merah - itu satu-satunya yang benar-benar tak terjelaskan", () => {
        const state = getPublicPopupOverlayState({ status: 'error', errorType: 'ngawur' });
        render(<PublicStreamStatusOverlay state={state} />);

        expect(state.variant).toBe('unknown');
        expect(nada()).toContain('text-status-fault');
    });
});

describe('tombol coba lagi mengikuti canRetry, tanpa perkecualian', () => {
    it('muncul untuk gangguan yang pulih', () => {
        const state = getPublicPopupOverlayState({ status: 'error', errorType: 'stalled' });
        render(<PublicStreamStatusOverlay state={state} onRetry={vi.fn()} />);

        expect(screen.getByRole('button', { name: /Coba Lagi/i })).toBeTruthy();
    });

    it('TIDAK muncul untuk vonis codec - mengklik ulang tidak mengubah dukungan browser', () => {
        const state = getPublicPopupOverlayState({ status: 'error', errorType: 'codec' });
        render(<PublicStreamStatusOverlay state={state} onRetry={vi.fn()} />);

        expect(screen.queryByRole('button', { name: /Coba Lagi/i })).toBeNull();
    });

    it('memanggil onRetry saat diklik', () => {
        const onRetry = vi.fn();
        const state = getPublicPopupOverlayState({ status: 'error', errorType: 'network' });
        render(<PublicStreamStatusOverlay state={state} onRetry={onRetry} />);

        screen.getByRole('button', { name: /Coba Lagi/i }).click();
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('tidak merender tombol tanpa handler, walau canRetry', () => {
        const state = getPublicPopupOverlayState({ status: 'error', errorType: 'network' });
        render(<PublicStreamStatusOverlay state={state} />);

        expect(screen.queryByRole('button', { name: /Coba Lagi/i })).toBeNull();
    });
});

describe('dasar-dasar render', () => {
    it('tidak merender apa pun tanpa state', () => {
        const { container } = render(<PublicStreamStatusOverlay state={null} />);
        expect(container.firstChild).toBeNull();
    });

    it('menampilkan judul dan deskripsi varian', () => {
        const state = getPublicPopupOverlayState({ status: 'error', errorType: 'stalled' });
        render(<PublicStreamStatusOverlay state={state} />);

        expect(screen.getByText('Gambar Terhenti')).toBeTruthy();
        expect(screen.getByText(state.description)).toBeTruthy();
    });

    it('varian loading menampilkan hitungan percobaan otomatis', () => {
        const state = getPublicPopupOverlayState({ status: 'connecting', loadingStage: 'connecting' });
        render(<PublicStreamStatusOverlay state={state} autoRetryCount={2} maxAutoRetries={3} />);

        expect(screen.getByText(/percobaan 2 dari 3/)).toBeTruthy();
    });
});
