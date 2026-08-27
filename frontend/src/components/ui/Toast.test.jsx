/*
 * Purpose: Kunci bahwa toast itu OPAK — dan bahwa tint statusnya tetap ada.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Keempat jenis toast mengirimkan satu `colorClass` yang latar satu-satunya adalah tint 10%:
 * `bg-status-live/10`, dan untuk info `bg-primary-100` yang juga alpha 10% tetap. Latar 10%
 * adalah latar 90% TEMBUS PANDANG — teks halaman di belakangnya terbaca menembus toast dan
 * kata-katanya bertumpuk. Dilaporkan 2026-08-27: "tulisannya tumpuk antara popup berhasil dengan
 * teks di halaman itu".
 *
 * Yang membuatnya bertahan lama: toast muncul lima detik lalu hilang, jadi ia nyaris tidak pernah
 * ditatap; dan di atas latar yang kebetulan kosong ia terlihat baik-baik saja. Ia hanya rusak di
 * halaman yang PADAT — yaitu tiap halaman admin yang sibuk, yaitu saat operator paling perlu
 * membaca hasilnya.
 *
 * Tintnya tidak pernah salah; ia hanya diminta menjadi seluruh latar. Sekarang latar opak dicat
 * lebih dulu dan tintnya menumpang DI ATASNYA, jadi keduanya bertahan.
 */

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast.jsx';
import { NOTIFICATION_CONFIG } from '../../contexts/NotificationContext.jsx';

const JENIS = Object.keys(NOTIFICATION_CONFIG);

/** Kelas latar yang opak: tanpa akhiran `/NN`, dan bukan skala alpha tetap seperti primary-100. */
const opak = (cls) => /(^|\s)bg-[a-z-]+(?![-a-z0-9])/.test(cls) && !/(^|\s)bg-[a-z-]+\/\d+/.test(cls);

function tampilkan(type) {
    return render(
        <Toast
            notification={{ id: `t-${type}`, type, title: 'Tersimpan', message: 'Kamera diperbarui' }}
            onDismiss={vi.fn()}
        />
    );
}

describe('toast tidak boleh tembus pandang', () => {
    for (const type of JENIS) {
        it(`'${type}' punya latar OPAK di akarnya`, () => {
            const { container } = tampilkan(type);
            const akar = container.firstElementChild;

            expect(
                akar.className,
                `toast '${type}' hanya berlatar tint - teks halaman akan terbaca menembusnya`,
            ).toContain('bg-surface-overlay');
            expect(opak('bg-surface-overlay')).toBe(true);
        });
    }

    it('kelas akarnya tidak pernah HANYA tint alpha', () => {
        for (const type of JENIS) {
            const { container, unmount } = tampilkan(type);
            const kelas = container.firstElementChild.className;

            const latar = kelas.match(/bg-[a-z0-9-]+(\/\d+)?/g) || [];
            const adaOpak = latar.some((c) => opak(c));

            expect(adaOpak, `toast '${type}' latarnya: ${latar.join(', ')}`).toBe(true);
            unmount();
        }
    });
});

describe('tintnya tetap hidup - perbaikannya bukan membuang warna', () => {
    for (const type of JENIS) {
        it(`'${type}' masih memakai tintnya di dalam`, () => {
            const { container } = tampilkan(type);
            const tint = NOTIFICATION_CONFIG[type].tintClass;

            // CSS.escape tidak ada di jsdom, dan tintnya memuat '/' - jadi dicocokkan lewat className.
            const pemakai = [...container.querySelectorAll('*')]
                .filter((el) => el.className && String(el.className).includes(tint));

            expect(pemakai.length, `tint ${tint} hilang`).toBeGreaterThan(0);
        });
    }

    it('tint TIDAK dipasang di akar - di sana ia akan menimpa latar opaknya', () => {
        for (const type of JENIS) {
            const { container, unmount } = tampilkan(type);
            const tint = NOTIFICATION_CONFIG[type].tintClass;

            expect(container.firstElementChild.className).not.toContain(tint);
            unmount();
        }
    });

    it('warna statusnya tetap terbaca di ikon dan bingkai', () => {
        const { container } = tampilkan('error');
        const kelas = container.firstElementChild.className;

        expect(kelas, 'sinyal warna di bingkai hilang').toContain('border-status-fault');
        expect(container.querySelector('.text-status-fault'), 'ikon kehilangan warnanya').not.toBeNull();
    });
});

describe('isinya tetap utuh', () => {
    it('judul dan pesan tetap dirender', () => {
        tampilkan('success');

        expect(screen.getByText('Tersimpan')).toBeTruthy();
        expect(screen.getByText('Kamera diperbarui')).toBeTruthy();
    });

    it('tiap jenis punya tint DAN bingkai - tidak ada yang setengah dikonfigurasi', () => {
        for (const type of JENIS) {
            expect(NOTIFICATION_CONFIG[type].tintClass, `${type}.tintClass`).toBeTruthy();
            expect(NOTIFICATION_CONFIG[type].frameClass, `${type}.frameClass`).toBeTruthy();
            // colorClass lama harus benar-benar hilang, bukan tertinggal dan terbaca diam-diam.
            expect(NOTIFICATION_CONFIG[type].colorClass, `${type} masih membawa colorClass lama`).toBeUndefined();
        }
    });
});
