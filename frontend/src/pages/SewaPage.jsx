/*
 * Purpose: Public sales page (/sewa) — what the system does, what renting it costs, and the
 *          alternative of running it on your own server. Reached from the landing page.
 * Caller: App.jsx public route.
 * Deps: publicBillingService (live price list), BrandingContext (company name + WhatsApp), router.
 * MainFuncs: SewaPage.
 * SideEffects: One GET to the public price list.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP
 * ----------------------------------
 * 1. NOT ONE rupiah figure is written here. Every price comes from /api/public/billing/plans, which
 *    exists because a previous hand-typed page advertised Rp 15.000 while billing charged Rp 25.000
 *    (see backend/controllers/publicBillingController.js). If the fetch fails the page shows no
 *    numbers at all and points at WhatsApp — a missing price is recoverable, a wrong one is not.
 * 2. Nothing is promised that the product does not do today. Motion detection ships as an opt-in
 *    add-on with a hardware caveat because it is per-camera and its cost depends on the box; the
 *    server-sizing figures come from measurements on a running deployment, not estimates.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publicBillingService } from '../services/publicBillingService';
import { useBranding } from '../contexts/BrandingContext';
import { setPageTitle } from '../utils/pageTitle.js';

function formatRupiah(value) {
    return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

const FEATURES = [
    {
        title: 'Pantau dari mana saja',
        body: 'HP, tablet, atau komputer lewat browser biasa. Tidak perlu memasang aplikasi.',
    },
    {
        title: 'Rekaman bisa diputar ulang',
        body: 'Pilih tanggal, lalu putar bagian yang Anda cari. Lama simpan mengikuti paket.',
    },
    {
        title: 'Kamera mati langsung ketahuan',
        body: 'Sistem memantau sendiri dan menandai kamera yang berhenti mengirim gambar.',
    },
    {
        title: 'Kamera pribadi tetap pribadi',
        body: 'Kamera Anda tidak pernah muncul di halaman publik. Hanya Anda yang bisa membukanya.',
    },
    {
        title: 'Hari kamera mati tidak ditagih',
        body: 'Tagihan dihitung harian. Hari saat kamera tidak jalan tidak ikut dihitung.',
    },
    {
        title: 'Deteksi gerakan (opsional)',
        body: 'Bisa diaktifkan per kamera. Kebutuhan perangkatnya kami hitung dulu bersama Anda.',
    },
];

/*
 * Sizing figures measured on a running deployment, not estimated — the full method and the numbers
 * behind them live in docs/spek-server.md. Disk is what actually runs out first: recording is a
 * stream copy, so 16 recorders together sit at roughly 1% of a 16-core CPU.
 */
const SIZING = [
    { scale: 'Sampai 8 kamera', cpu: '2 vCPU', ram: '4 GB RAM', disk: '±70 GB' },
    { scale: 'Sampai 32 kamera', cpu: '4 vCPU', ram: '8 GB RAM', disk: '±265 GB' },
    { scale: 'Sampai 64 kamera', cpu: '8 vCPU', ram: '16 GB RAM', disk: '±530 GB' },
];

function PlanCard({ plan }) {
    if (plan.is_trial) {
        return (
            <div className="flex flex-col rounded-card border border-primary bg-surface-raised p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">{plan.name}</p>
                <p className="mt-3 text-2xl font-bold tabular-nums text-content">Gratis</p>
                <p className="mt-1 text-sm text-content-muted">
                    {plan.trial_days ? `${plan.trial_days} hari pertama` : 'masa coba'}
                </p>
                <div className="my-4 h-px bg-edge" />
                <p className="text-sm text-content">
                    sampai <b className="tabular-nums">{plan.max_cameras}</b> kamera
                </p>
                {plan.description && (
                    <p className="mt-auto pt-3 text-xs text-content-subtle">{plan.description}</p>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col rounded-card border border-edge bg-surface-raised p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">{plan.name}</p>
            <p className="mt-3 text-2xl font-bold tabular-nums text-content">
                {formatRupiah(plan.price_per_camera)}
            </p>
            <p className="mt-1 text-sm text-content-muted">per kamera, per bulan</p>
            <div className="my-4 h-px bg-edge" />
            <p className="text-sm text-content">
                sampai <b className="tabular-nums">{plan.max_cameras}</b> kamera
            </p>
            <div className="mt-auto pt-3 text-xs text-content-subtle">
                {plan.recording_price_per_camera > 0 ? (
                    <>
                        <p>Tambah rekaman</p>
                        <p className="font-semibold text-content">
                            + {formatRupiah(plan.recording_price_per_camera)}
                        </p>
                        {/*
                          * 0 means the depth was never configured. Printing "0 hari" would read as
                          * "we keep nothing", which is the opposite of what the surcharge buys.
                          */}
                        <p className="mt-1">
                            {plan.recording_retention_days > 0
                                ? `Simpan ${plan.recording_retention_days} hari`
                                : 'Lama simpan disepakati saat pemasangan'}
                        </p>
                    </>
                ) : (
                    <p>Rekaman belum termasuk</p>
                )}
            </div>
        </div>
    );
}

export default function SewaPage() {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const { branding } = useBranding();

    useEffect(() => setPageTitle('Sewa CCTV & Pasang Sistem Sendiri - RAF'), []);

    useEffect(() => {
        let isMounted = true;
        publicBillingService.getPublicPlans()
            .then((response) => {
                if (!isMounted) return;
                setPlans(Array.isArray(response?.data) ? response.data : []);
                setLoading(false);
            })
            .catch(() => {
                if (!isMounted) return;
                setFailed(true);
                setLoading(false);
            });
        return () => { isMounted = false; };
    }, []);

    const companyName = branding?.company_name || 'RAF';
    /*
     * Same reasoning as RegisterPage: render no button at all when no number is configured. A dead
     * wa.me link on the one page whose job is to start a conversation is worse than no link.
     */
    const whatsapp = String(branding?.whatsapp_number || '').trim();
    const waLink = whatsapp
        ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(
            'Halo, saya ingin bertanya soal sewa CCTV dan pemasangan sistemnya.')}`
        : '';

    return (
        <div className="min-h-screen bg-surface-sunken">
            <header className="border-b border-edge bg-surface">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
                    <Link to="/" className="flex min-w-0 items-center gap-2 text-content">
                        <span className="h-2.5 w-2.5 flex-none rounded-sm bg-primary" aria-hidden="true" />
                        <span className="truncate text-sm font-semibold tracking-wide">{companyName}</span>
                    </Link>
                    <Link
                        to="/daftar"
                        className="flex-none rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                    >
                        Daftar
                    </Link>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-4 py-10 sm:py-14">

                {/* ---- hero ---- */}
                <section>
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                        Sewa layanan / pasang sendiri
                    </p>
                    <h1 className="mt-3 text-3xl font-bold leading-tight text-content">
                        Pasang sekali, pantau dari mana saja.
                    </h1>
                    <p className="mt-4 max-w-2xl text-base text-content-muted">
                        Kamera, rekaman, pelanggan, dan tagihan berjalan dari satu panel. Sewa per kamera
                        per bulan, atau pasang sistemnya di server Anda sendiri.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3">
                        <Link
                            to="/daftar"
                            className="rounded-control bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                        >
                            Mulai sewa
                        </Link>
                        {waLink && (
                            <a
                                href={waLink}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-control border border-edge bg-surface px-4 py-2.5 text-sm font-medium text-content transition-colors hover:border-edge-strong hover:bg-surface-raised"
                            >
                                Tanya lewat WhatsApp
                            </a>
                        )}
                    </div>
                </section>

                {/* ---- fitur ---- */}
                <section className="mt-14">
                    <h2 className="text-base font-semibold text-content">Yang Anda dapat</h2>
                    <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
                        {FEATURES.map((feature) => (
                            <div key={feature.title} className="flex gap-3">
                                <svg
                                    className="mt-0.5 h-4 w-4 flex-none text-primary"
                                    viewBox="0 0 22 22"
                                    fill="none"
                                    aria-hidden="true"
                                >
                                    <path
                                        d="M4 11.5l4.5 4.5L18 6.5"
                                        stroke="currentColor"
                                        strokeWidth="2.6"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-content">{feature.title}</p>
                                    <p className="mt-1 text-sm text-content-muted">{feature.body}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ---- harga ---- */}
                <section className="mt-14">
                    <h2 className="text-base font-semibold text-content">Harga sewa</h2>
                    <p className="mt-1 text-sm text-content-muted">
                        Dihitung per kamera. Saldo dipotong harian, dan hari saat kamera tidak jalan
                        tidak ikut dihitung.
                    </p>

                    {loading && (
                        <p className="mt-5 text-sm text-content-muted">Memuat daftar harga…</p>
                    )}

                    {/*
                      * No fallback numbers on purpose. Showing a stale hardcoded price would be worse
                      * than showing none — this is exactly the drift the public endpoint was built to end.
                      */}
                    {!loading && (failed || plans.length === 0) && (
                        <div className="mt-5 rounded-card border border-edge bg-surface-raised p-5">
                            <p className="text-sm text-content">
                                Daftar harga sedang tidak bisa dimuat.
                            </p>
                            <p className="mt-1 text-sm text-content-muted">
                                Silakan tanyakan langsung — kami kirimkan rinciannya.
                            </p>
                            {waLink && (
                                <a
                                    href={waLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-4 inline-block rounded-control bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                                >
                                    Tanya harga lewat WhatsApp
                                </a>
                            )}
                        </div>
                    )}

                    {!loading && !failed && plans.length > 0 && (
                        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            {plans.map((plan) => <PlanCard key={plan.key} plan={plan} />)}
                        </div>
                    )}
                </section>

                {/* ---- dua jalur ---- */}
                <section className="mt-14 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-card border border-edge bg-surface-raised p-5">
                        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                            Sewa layanan
                        </p>
                        <p className="mt-3 text-sm text-content-muted">
                            Kami yang mengurus server, rekaman, dan pemeliharaan. Anda tinggal pakai,
                            bayar per kamera per bulan.
                        </p>
                    </div>
                    <div className="rounded-card border border-edge bg-surface-raised p-5">
                        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                            Pasang di server sendiri
                        </p>
                        <p className="mt-3 text-sm text-content-muted">
                            Sistem berjalan penuh di server Anda, dengan pendampingan pemasangan.
                            Lisensi untuk satu badan usaha. Biaya menyesuaikan kebutuhan.
                        </p>
                    </div>
                </section>

                {/* ---- spek ---- */}
                <section className="mt-14">
                    <h2 className="text-base font-semibold text-content">Perkiraan spesifikasi server</h2>
                    <p className="mt-1 text-sm text-content-muted">
                        Untuk yang memasang sendiri. Angka ini diukur dari sistem yang sedang berjalan,
                        bukan perkiraan di atas kertas.
                    </p>
                    <div className="mt-5 grid gap-4 sm:grid-cols-3">
                        {SIZING.map((row) => (
                            <div key={row.scale} className="rounded-card border border-edge bg-surface-raised p-5">
                                <p className="text-sm font-semibold text-content">{row.scale}</p>
                                <dl className="mt-3 space-y-1 text-sm text-content-muted">
                                    <div className="flex justify-between gap-3">
                                        <dt>Prosesor</dt><dd className="tabular-nums text-content">{row.cpu}</dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt>Memori</dt><dd className="tabular-nums text-content">{row.ram}</dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt>Penyimpanan</dt><dd className="tabular-nums text-content">{row.disk}</dd>
                                    </div>
                                </dl>
                            </div>
                        ))}
                    </div>
                    <p className="mt-4 text-xs text-content-subtle">
                        Penyimpanan dihitung untuk rekaman 24 jam ke belakang: jumlah kamera × jam simpan
                        × 0,3 GB. Kamera dengan bitrate tinggi butuh lebih banyak. Perekaman hampir tidak
                        membebani prosesor, jadi yang lebih dulu habis biasanya disk — bukan CPU.
                    </p>
                </section>

                {/* ---- penutup ---- */}
                <section className="mt-14 rounded-card border border-edge bg-surface-raised p-6">
                    <h2 className="text-base font-semibold text-content">Mau mulai yang mana?</h2>
                    <p className="mt-1 text-sm text-content-muted">
                        Konsultasi dulu juga boleh — tidak ada biaya survei.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3">
                        <Link
                            to="/daftar"
                            className="rounded-control bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                        >
                            Daftar sewa
                        </Link>
                        {waLink && (
                            <a
                                href={waLink}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-control border border-edge bg-surface px-4 py-2.5 text-sm font-medium text-content transition-colors hover:border-edge-strong hover:bg-surface-raised"
                            >
                                Hubungi kami
                            </a>
                        )}
                    </div>
                </section>
            </main>

            <footer className="border-t border-edge bg-surface">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5">
                    <p className="text-xs text-content-subtle">© {companyName}</p>
                    <Link to="/" className="text-xs text-content-muted hover:underline">
                        Kembali ke beranda
                    </Link>
                </div>
            </footer>
        </div>
    );
}
