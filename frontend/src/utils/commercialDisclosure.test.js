/*
 * Purpose: Menegakkan bahwa setiap konten komersial di permukaan publik punya label pengungkapan,
 *          dan bahwa labelnya diputuskan di SATU tempat.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Memusatkan kosakata saja tidak menegakkan apa pun - orang berikutnya tinggal menulis ulang
 * labelnya langsung di komponen barunya, persis seperti empat komponen lama melakukannya. Yang
 * benar-benar menegakkan adalah tes terakhir di berkas ini: ia menyapu seluruh permukaan publik
 * dan menolak label pengungkapan yang ditulis langsung di luar modul kosakata.
 *
 * Label ini bukan hiasan. Ia satu-satunya cara pengunjung tahu mana yang dibayar dan mana yang
 * bukan, dan permukaan ini dilihat 605 orang sebulan yang 59% di antaranya kembali lagi.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DISCLOSURE, COMMERCIAL_KINDS, disclosureFor } from './commercialDisclosure.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Komentar dibuang dulu: docstring modul memang menyebut labelnya, dan itu bukan pelanggaran. */
function kodeSaja(isi) {
    return isi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/*
 * Permukaan ADMIN dikecualikan: di sana "Toko Rekanan" adalah nama menu dan "Iklan" adalah judul
 * halaman pengaturan - keduanya ditujukan ke operator, bukan pengungkapan ke pengunjung.
 * Konvensi repo: halaman admin bernama *Management.jsx atau berada di bawah folder admin/.
 */
const adminBerkas = (nama) => /Management\.jsx$/.test(nama);

function berkasJsx(dir, keluar = []) {
    if (!fs.existsSync(dir)) return keluar;
    for (const entri of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entri.name);
        if (entri.isDirectory()) {
            if (entri.name !== 'admin' && entri.name !== '__tests__') berkasJsx(p, keluar);
        } else if (/\.jsx$/.test(entri.name)
            && !/\.(test|spec)\.jsx$/.test(entri.name)
            && !adminBerkas(entri.name)) {
            keluar.push(p);
        }
    }
    return keluar;
}

/*
 * Dicocokkan sebagai label yang benar-benar DIRENDER, bukan sebagai substring - kata "Promo"
 * muncul di nama komponen, impor, dan prosa di belasan berkas, dan mencocokkan semuanya membuat
 * tes ini berisik sampai tidak ada yang percaya lagi.
 *
 * Dua bentuk yang dianggap pelanggaran, dan keduanya adalah cara nyata orang menulis label:
 *   teks JSX          <span ...>Iklan</span>
 *   literal string    label = 'Iklan'
 */
function ditulisLangsung(isi, label) {
    // Label kita seluruhnya huruf dan spasi, jadi tidak ada yang perlu di-escape.
    const teksJsx = new RegExp('>\\s*' + label + '\\s*<');
    return teksJsx.test(isi)
        || isi.includes(`'${label}'`)
        || isi.includes(`"${label}"`);
}

describe('kosakata pengungkapan', () => {
    it('setiap jenis punya label yang tidak kosong', () => {
        expect(COMMERCIAL_KINDS.length).toBeGreaterThan(0);
        for (const kind of COMMERCIAL_KINDS) {
            expect(DISCLOSURE[kind], kind).toBeTruthy();
            expect(DISCLOSURE[kind].trim(), kind).not.toBe('');
        }
    });

    it('MELEMPAR untuk jenis tak dikenal, bukan memberi cadangan yang aman', () => {
        /*
         * Cadangan yang "aman" justru bentuk kegagalan yang mau dicegah: jenis baru tayang
         * dengan label yang salah dan tidak ada yang tahu. Galat pemrograman harus berisik.
         */
        expect(() => disclosureFor('belum-ada')).toThrow(/tanpa label pengungkapan/);
        expect(() => disclosureFor(undefined)).toThrow();
        expect(() => disclosureFor('')).toThrow();
    });

    it('kosakatanya beku - tidak bisa diubah diam-diam saat runtime', () => {
        expect(Object.isFrozen(DISCLOSURE)).toBe(true);
    });

    it('kredit sponsor berbunyi berbeda dari tiga label penjualan', () => {
        // Sponsor bukan penjualan; menyamakan bunyinya akan menyesatkan ke dua arah sekaligus.
        const penjualan = [DISCLOSURE.affiliate, DISCLOSURE.promo, DISCLOSURE.ads];
        expect(penjualan).not.toContain(DISCLOSURE.sponsor);
    });
});

describe('penegakan: tidak ada label yang ditulis langsung di permukaan publik', () => {
    /*
     * Ini penjaga sesungguhnya. Komponen komersial BARU yang menyalin label dari komponen lama -
     * cara paling wajar seseorang menambah jenis kelima - akan memerahkan tes ini.
     *
     * Permukaan admin dikecualikan: di sana "Toko Rekanan" adalah nama menu dan judul halaman,
     * bukan pengungkapan kepada pengunjung.
     */
    const kandidat = [
        ...berkasJsx(path.join(SRC, 'components')),
        ...berkasJsx(path.join(SRC, 'pages')),
    ];

    it('menemukan berkas untuk disapu (kalau nol, tesnya sendiri yang rusak)', () => {
        expect(kandidat.length).toBeGreaterThan(20);
    });

    for (const kind of COMMERCIAL_KINDS) {
        it(`label '${kind}' hanya berasal dari modul kosakata`, () => {
            const label = DISCLOSURE[kind];
            const pelanggar = kandidat.filter((p) => ditulisLangsung(kodeSaja(fs.readFileSync(p, 'utf8')), label));

            expect(
                pelanggar.map((p) => path.relative(SRC, p)),
                `Label "${label}" ditulis langsung. Pakai disclosureFor('${kind}') dari utils/commercialDisclosure.js`,
            ).toEqual([]);
        });
    }

    /*
     * Lubang yang ketahuan saat memasang arbiter: keenam pemasangan InlineAdSlot meng-override
     * labelnya jadi "Sponsored", sehingga label terpusat itu tidak pernah benar-benar dipakai -
     * dan kata Inggris itu kurang jelas bagi pembaca yang justru penting di sini, sekaligus
     * tidak konsisten dengan tiga label lain yang semuanya bahasa Indonesia.
     *
     * Propnya kini dicabut: label adalah milik SLOT, bukan pemanggilnya. Tes ini menolak
     * pengembaliannya.
     */
    it('slot iklan tidak menerima label dari pemanggil', () => {
        const pelanggar = kandidat.filter((p) => /<InlineAdSlot[\s\S]{0,400}?label=/.test(fs.readFileSync(p, 'utf8')));
        expect(
            pelanggar.map((p) => path.relative(SRC, p)),
            'label iklan diputuskan slot, bukan pemanggil - hapus prop label-nya',
        ).toEqual([]);
    });

    it('keempat permukaan komersial yang ada memang memakai modulnya', () => {
        const wajib = [
            'components/commerce/AffiliateOfferCard.jsx',
            'components/promo/PromoBanner.jsx',
            'components/ads/InlineAdSlot.jsx',
            'components/landing/SponsorStrip.jsx',
        ];
        for (const rel of wajib) {
            const isi = fs.readFileSync(path.join(SRC, rel), 'utf8');
            expect(isi, `${rel} tidak mengimpor kosakata pengungkapan`).toContain('commercialDisclosure');
            expect(isi, `${rel} tidak memanggil disclosureFor`).toContain('disclosureFor(');
        }
    });
});
