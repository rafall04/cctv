/*
 * Purpose: Halaman publik /dukungan — apa artinya mendukung RAF CCTV, dan apa yang didapat pendukung.
 * Caller: App.jsx (rute publik /dukungan).
 * Deps: supportService (angka jangkauan), SponsorStrip, BrandingContext, commercialDisclosure.
 * MainFuncs: SupportPage.
 * SideEffects: Satu GET angka jangkauan saat halaman dibuka.
 *
 * KENAPA HALAMAN INI ADA
 * ----------------------
 * Sampai sekarang seluruh penjelasan tentang dukungan ada di kepala pemiliknya dan di proposal
 * yang dikirim satu per satu. Distributor yang tertarik tidak punya tempat untuk melihat sendiri
 * apa yang sebenarnya ditawarkan — dan permukaan ini menjual KELANGKAAN, yang justru sulit
 * dipercaya kalau tidak ditunjukkan bentuknya.
 *
 * TIDAK ADA SATU ANGKA PUN YANG DITULIS DI SINI
 * ---------------------------------------------
 * Angka jangkauan datang dari /api/public/support-reach setiap kali halaman dibuka. Menuliskannya
 * di dalam berkas ini akan membuatnya benar hari ini dan berbohong tiga bulan lagi, tanpa ada yang
 * memeriksa — persis aturan kejujuran permukaan publik di docs/frontend-guide.md. Kalau angkanya
 * tidak bisa dibaca, bloknya HILANG; ia tidak pernah menampilkan nol sebagai kalau-kalau.
 *
 * KENAPA BLOK KONTAK BISA TIDAK ADA
 * ---------------------------------
 * Nomor WhatsApp diambil dari pengaturan branding, dan di produksi ia belum diisi. Tombol yang
 * tidak menuju ke mana-mana lebih buruk daripada tidak ada tombol: ia mengajari pengunjung bahwa
 * tombol di situs ini tidak melakukan apa-apa. Jadi bloknya hanya muncul ketika nomornya ada.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBranding } from '../contexts/BrandingContext';
import SponsorStrip from '../components/landing/SponsorStrip';
import { getPublicReach } from '../services/supportService';
import { disclosureFor } from '../utils/commercialDisclosure.js';

/* Angka besar dibaca sekilas; ribuan diberi pemisah lokal supaya 2924 tidak terbaca 292. */
const angka = (n) => new Intl.NumberFormat('id-ID').format(n);

/**
 * `08…` dan `+62…` sama-sama sah diketik operator; wa.me hanya menerima digit dengan kode negara.
 * Disalin kecil-kecilan ke sini alih-alih mengimpor dari layanan ADMIN, supaya berkas admin tidak
 * ikut terbawa ke bundel publik demi satu fungsi enam baris.
 */
function digitWhatsApp(nilai) {
    const digit = String(nilai || '').replace(/\D/g, '');
    if (!digit) return '';
    if (digit.startsWith('62')) return digit;
    if (digit.startsWith('0')) return `62${digit.slice(1)}`;
    return digit;
}

const CARA = [
    {
        key: 'distributor',
        judul: 'Distributor CCTV',
        ringkas: 'Titipkan unit, bukan uang.',
        isi: 'Anda menitipkan kamera; kami yang memasang, menyalakan, dan merawatnya di titik umum '
            + 'yang ramai. Unitnya tetap milik Anda dan bisa ditarik kapan saja. Yang Anda dapat: '
            + 'nama toko Anda melekat pada kamera itu di halaman publiknya, dan barang Anda tampil '
            + 'di slot komersial kamera-kamera tersebut.',
    },
    {
        key: 'sponsor',
        judul: 'Sponsor Lokal',
        ringkas: 'Dukung satu titik di kampung Anda.',
        isi: 'Menanggung biaya satu atau beberapa kamera di area Anda sendiri. Logo Anda tampil di '
            + 'kaki halaman beranda dan pada kamera yang Anda dukung. Cocok untuk usaha yang '
            + 'pelanggannya memang orang sekitar titik itu.',
    },
    {
        key: 'affiliate',
        judul: disclosureFor('affiliate'),
        ringkas: 'Barang Anda di bawah siaran langsung.',
        isi: 'Satu barang, satu kartu, tampil sendirian di bawah kamera yang relevan. Tidak ada '
            + 'tumpukan iklan di sebelahnya — dan justru itu produknya.',
    },
];

const PENEMPATAN = [
    ['Popup kamera', 'Muncul di bawah siaran langsung, tepat saat penonton sedang memperhatikan.'],
    ['Halaman area', 'Di daftar kamera satu kecamatan, untuk penonton yang sedang menelusuri sekitarnya.'],
    ['Beranda', 'Halaman depan, dilihat setiap pengunjung baru.'],
    ['Putar ulang', 'Di halaman rekaman, tempat orang bertahan paling lama.'],
];

export default function SupportPage() {
    const { branding } = useBranding();
    const [reach, setReach] = useState(null);

    useEffect(() => {
        let hidup = true;
        getPublicReach().then((data) => { if (hidup) setReach(data); });
        return () => { hidup = false; };
    }, []);

    const wa = digitWhatsApp(branding?.whatsapp_number);
    const perusahaan = branding?.company_name || 'RAF';

    /* Nol berarti "belum ada yang bisa ditunjukkan", bukan "sungguh nol" — jangan tampilkan. */
    const punyaAngka = Boolean(reach && (reach.sessions > 0 || reach.cameras > 0));

    return (
        <div className="min-h-screen bg-surface-sunken">
            <header className="border-b border-edge bg-surface">
                <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
                    <Link
                        to="/"
                        className="rounded-control border border-edge px-3 py-1.5 text-sm text-content-muted transition-colors hover:text-content"
                    >
                        &larr; Beranda
                    </Link>
                    <h1 className="min-w-0 truncate text-base font-semibold text-content">
                        Dukung {perusahaan} CCTV
                    </h1>
                </div>
            </header>

            <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
                <p className="text-sm leading-relaxed text-content-muted sm:text-base">
                    Kamera-kamera di sini dipasang dan dirawat sendiri, dan siarannya bisa ditonton
                    siapa saja tanpa bayar. Biayanya nyata: perangkat, listrik, jaringan, dan
                    penyimpanan rekaman. Halaman ini menjelaskan tiga cara ikut menanggungnya — dan
                    apa yang Anda dapat kembali.
                </p>

                {punyaAngka && (
                    <section className="mt-6 grid grid-cols-3 gap-2 sm:gap-3" aria-label="Jangkauan">
                        {[
                            [angka(reach.sessions), `tontonan / ${reach.window_days} hari`],
                            [angka(reach.cameras), 'kamera publik'],
                            [angka(reach.areas), 'wilayah'],
                        ].map(([nilai, label]) => (
                            <div key={label} className="rounded-card border border-edge bg-surface px-3 py-3 text-center">
                                <div className="font-mono text-lg font-bold tabular-nums text-content sm:text-xl">
                                    {nilai}
                                </div>
                                <div className="mt-0.5 text-[11px] leading-tight text-content-subtle">{label}</div>
                            </div>
                        ))}
                    </section>
                )}

                <section className="mt-8 space-y-3" aria-label="Cara mendukung">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
                        Tiga cara
                    </h2>
                    {CARA.map((cara) => (
                        <article key={cara.key} className="rounded-card border border-edge bg-surface p-4">
                            <h3 className="text-base font-semibold text-content">{cara.judul}</h3>
                            <p className="mt-0.5 text-sm font-medium text-primary-600 dark:text-primary-400">
                                {cara.ringkas}
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-content-muted">{cara.isi}</p>
                        </article>
                    ))}
                </section>

                <section className="mt-8" aria-label="Penempatan">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
                        Di mana Anda tampil
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-content-muted">
                        Setiap tempat hanya memuat SATU blok komersial pada satu waktu. Tidak ada
                        tumpukan, tidak ada rebutan perhatian — pendukung yang tampil, tampil sendirian.
                    </p>
                    <dl className="mt-3 divide-y divide-edge overflow-hidden rounded-card border border-edge bg-surface">
                        {PENEMPATAN.map(([nama, jelas]) => (
                            <div key={nama} className="px-4 py-3">
                                <dt className="text-sm font-medium text-content">{nama}</dt>
                                <dd className="mt-0.5 text-sm text-content-muted">{jelas}</dd>
                            </div>
                        ))}
                    </dl>
                </section>

                {wa && (
                    <section className="mt-8 rounded-card border border-edge bg-surface p-4 text-center">
                        <h2 className="text-base font-semibold text-content">Tertarik?</h2>
                        <p className="mx-auto mt-1 max-w-md text-sm text-content-muted">
                            Ceritakan dulu bentuk dukungan yang Anda pikirkan. Tidak ada paket wajib
                            dan tidak ada kontrak minimum.
                        </p>
                        <a
                            href={`https://wa.me/${wa}?text=${encodeURIComponent(`Halo ${perusahaan}, saya ingin tanya soal dukungan CCTV.`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-block rounded-control bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
                        >
                            Hubungi lewat WhatsApp
                        </a>
                    </section>
                )}

                {/* Menyembunyikan diri saat belum ada sponsor aktif — footer tidak tumbuh di hari nol. */}
                <div className="mt-10">
                    <SponsorStrip />
                </div>
            </main>
        </div>
    );
}
