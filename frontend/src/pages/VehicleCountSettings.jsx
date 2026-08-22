/*
 * Purpose: Admin page to turn vehicle counting on for any camera and tune it — separate page from Ronda Digital.
 * Caller: App.jsx admin routes.
 * Deps: vehicleCountAdminService, CountingLineEditor, NotificationContext.
 * MainFuncs: VehicleCountSettings.
 * SideEffects: reads/writes counting config through the admin API.
 *
 * Penghitungan memakai 4-6 dari 16 core per kamera, jadi halaman ini menyebutkan batas itu
 * di depan: menyalakannya di sepuluh kamera bukan hanya lambat, tetapi akan menjatuhkan
 * layanan yang sedang dipakai orang.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import vehicleCountAdminService from '../services/vehicleCountAdminService';
import CountingLineEditor from '../components/admin/vehicle-count/CountingLineEditor.jsx';
import PanduanPanel from '../components/admin/PanduanPanel.jsx';

/*
 * `text-base sm:text-sm`, bukan `text-sm` saja: Safari iOS memperbesar seluruh halaman begitu
 * jari menyentuh input yang fontnya di bawah 16 px, dan pengguna harus mencubit untuk kembali.
 * Di layar lebar ukurannya kembali 14 px. Halaman ini memang dipakai dari HP di lapangan.
 */
const KELAS_INPUT = 'w-full rounded-control border border-edge bg-surface px-3 py-2 text-base sm:text-sm text-content transition-colors focus:border-edge-strong focus:outline-none';
const KELAS_TOMBOL = 'min-h-[44px] rounded-control border border-edge px-3 py-2 text-sm font-medium text-content transition-colors hover:border-edge-strong hover:bg-surface-raised sm:min-h-0';

/* Jumlah kamera yang realistis berjalan bersamaan di satu server 16 core. */
const BATAS_WAJAR = 3;

/*
 * Dua model ditandai "jangan dipakai", dan keduanya sempat MENANG di angka lebih dulu. Daftar
 * ini menyimpan sebabnya supaya tidak ada yang menaikkannya lagi hanya karena mAP-nya tinggi.
 *
 * v2 — menyisihkan 443 bingkai gelap dari latihan DAN validasi, jadi mAP 0,629 miliknya tidak
 * pernah mengukur malam. Setelah senja ia menandai motor sebagai mobil; pemilik yang menemukan,
 * beberapa jam setelah dipasang.
 *
 * v3 — sudah dilatih dengan bingkai malam dan menang di setiap kondisi, tetapi mewarisi
 * kekeliruan gurunya: yolo11x memakai kelas COCO dan tidak mengenal truk kargo Indonesia, jadi
 * bak tinggi yang disorot lampu dilabeli "bus". Di lapangan ia melaporkan 41% bus pada pukul
 * satu pagi. Dua puluh empat potongan diperiksa satu per satu: semuanya truk.
 *
 * Aturan yang lahir dari keduanya: sebuah model hanya boleh naik setelah diuji pada kondisi
 * yang akan benar-benar ia hadapi, DAN komposisi keluarannya dilihat sebagai gambar — bukan
 * hanya sebagai angka.
 */
const MODEL_PILIHAN = [
    { value: 'bojonegoro-v4.pt', label: 'Bojonegoro v4 — dianjurkan, 12 kamera siang & malam' },
    { value: 'kamera15-v1.pt', label: 'Kamera 15 v1 — hanya dilatih di satu kamera' },
    { value: 'bojonegoro-v3.pt', label: 'v3 — truk malam dilaporkan bus, jangan dipakai' },
    { value: 'kamera15-v2.pt', label: 'v2 — motor malam dilaporkan mobil, jangan dipakai' },
    { value: 'yolo11m.pt', label: 'yolo11m (umum, COCO)' },
    { value: 'yolo11s.pt', label: 'yolo11s (umum, lebih ringan)' },
];

/*
 * Isi panduan ditulis dari hal-hal yang benar-benar salah dipahami saat menyetel kamera pertama,
 * bukan dari daftar istilah. Setiap angka di sini terukur di kamera jembatan Sosrodilogo.
 */
const PANDUAN = [
    {
        tanya: 'Bagaimana kendaraan dihitung?',
        jawab: 'Saat melewati garis kuning. Satu kendaraan dihitung SEKALI, pada garis pertama '
            + 'yang ia lintasi — jadi menambah garis memperluas cakupan tanpa membuat hitungan '
            + 'ganda. Di kamera ini satu garis hanya menangkap 57% lalu lintas; tiga garis 87%.',
    },
    {
        tanya: 'Menggambar garis dari HP',
        jawab: 'Tarik jari di atas gambar untuk membuat garis baru. Untuk menggeser, tarik '
            + 'bulatan kuning di ujungnya. Ruas yang terlalu pendek dibuang sendiri karena tidak '
            + 'akan pernah dilintasi dengan andal. Tekan "Simpan setelan" setelah selesai.',
    },
    {
        tanya: 'Arah A dan arah B itu apa?',
        jawab: 'Panah hijau di gambar adalah arah A; garis putus-putus biru arah sebaliknya (B). '
            + 'Nama yang Anda isi itulah yang muncul di halaman publik, jadi tulis nama tempat '
            + 'yang dikenal orang — "Menuju jembatan", bukan "kiri".',
    },
    {
        tanya: 'Ambang deteksi vs ambang tampil kotak',
        jawab: 'Sengaja dipisah. Melacak butuh peka (0,1) supaya motor kecil di kejauhan tidak '
            + 'lolos; menampilkan kotak butuh rapi (0,35) supaya tayangan publik tidak penuh '
            + 'kotak ragu-ragu. Menaikkan ambang deteksi akan mengurangi hitungan, bukan '
            + 'sekadar merapikan tampilan.',
    },
    {
        tanya: 'Ukuran olah (imgsz) — apakah makin besar makin bagus?',
        jawab: 'Tidak. Pada kamera CCTV yang gambarnya sudah lunak, 384–512 terukur mengalahkan '
            + '640: memperbesar hanya memperbesar derau, sambil memakan CPU jauh lebih banyak '
            + 'dan membuat penghitung tertinggal dari siaran.',
    },
    {
        tanya: 'Angkanya terlihat aneh, apa yang saya cek?',
        jawab: 'Baris kecil di bawah ringkasan: kalau "frame terakhir" lebih dari beberapa detik, '
            + 'masalahnya di siaran kamera, bukan di penghitungan. Kalau fps turun jauh di bawah '
            + '8, turunkan FPS olah atau imgsz. Kalau satu arah nyaris nol, kemungkinan besar '
            + 'panah arahnya terbalik.',
    },
    {
        tanya: 'Apakah menyimpan memutus tayangan publik?',
        jawab: 'Tidak. Penghitung membaca setelan baru sambil terus berjalan — prosesnya tidak '
            + 'dimulai ulang dan hitungannya tidak ter-reset. Termasuk saat mengganti model.',
    },
    {
        tanya: 'Model mana yang dipilih?',
        jawab: 'Bojonegoro v4 — dianjurkan. Dilatih dari 12 kamera Bojonegoro sekaligus, siang '
            + 'sampai malam. Diuji terpisah per kondisi: malam 0,53 berbanding 0,27 milik v1. '
            + 'Catatan jujur: bus malam dicatat sebagai truk, karena truk kargo berbak tinggi '
            + 'dan bus nyaris tak terbedakan dalam gelap — dan bus di sini hanya ~3% kendaraan.',
    },
    {
        tanya: 'Kenapa angka bagus belum tentu hasilnya bagus?',
        jawab: 'Karena set uji bisa tidak mewakili keadaan sebenarnya. v2 menang di semua angka '
            + 'validasi tetapi gagal setelah gelap, sebab bingkai malam memang tidak ikut '
            + 'dilatihkan. Kalau Anda mengganti model, lihat sendiri hasilnya di jam tersibuk '
            + 'DAN setelah matahari terbenam sebelum menganggapnya lebih baik.',
    },
];

// Delapan arah baku menutup hampir semua jalan; sudut miring tetap bisa diketik persis di
// bawahnya. Sumbu Y menunjuk ke BAWAH pada gambar, jadi "utara" bernilai negatif.
const ARAH_CEPAT = [
    { label: 'Timur', panah: '→', nilai: [1, 0] },
    { label: 'Barat', panah: '←', nilai: [-1, 0] },
    { label: 'Utara', panah: '↑', nilai: [0, -1] },
    { label: 'Selatan', panah: '↓', nilai: [0, 1] },
];

function Baris({ label, anak, keterangan }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-content-muted">{label}</span>
            {anak}
            {keterangan && <span className="text-xs text-content-subtle">{keterangan}</span>}
        </label>
    );
}

export default function VehicleCountSettings() {
    const { showNotification } = useNotification();
    const confirm = useConfirm();
    const [terpasang, setTerpasang] = useState([]);
    const [tersedia, setTersedia] = useState([]);
    const [dipilih, setDipilih] = useState(null);
    const [draft, setDraft] = useState(null);
    const [memuat, setMemuat] = useState(true);
    const [menyimpan, setMenyimpan] = useState(false);
    const [kameraBaru, setKameraBaru] = useState('');
    const [ringkasan, setRingkasan] = useState(null);

    const muatDaftar = useCallback(async () => {
        try {
            const [a, b] = await Promise.all([
                vehicleCountAdminService.listCameras(),
                vehicleCountAdminService.listAvailable(),
            ]);
            setTerpasang(a?.data || []);
            setTersedia(b?.data || []);
        } catch {
            showNotification('Gagal memuat daftar penghitungan', 'error');
        } finally {
            setMemuat(false);
        }
    }, [showNotification]);

    useEffect(() => { muatDaftar(); }, [muatDaftar]);

    const muatRingkasan = useCallback(async (cameraId) => {
        try {
            const hasil = await vehicleCountAdminService.getSummary(cameraId);
            setRingkasan(hasil?.data || null);
        } catch {
            setRingkasan(null);
        }
    }, []);

    const bukaKamera = useCallback(async (cameraId) => {
        try {
            const hasil = await vehicleCountAdminService.getCamera(cameraId);
            setDipilih(cameraId);
            setDraft(hasil?.data || null);
            muatRingkasan(cameraId);
        } catch {
            showNotification('Gagal memuat setelan kamera', 'error');
        }
    }, [showNotification, muatRingkasan]);

    /* Kamera pertama yang sudah diatur langsung dibuka. Tanpa ini halaman terbuka kosong dan
       angka yang sebenarnya SUDAH ada terbaca sebagai "datanya tidak muncul" — nyatanya cuma
       belum diklik. Mengutamakan yang sedang berjalan supaya yang terbuka adalah yang hidup. */
    useEffect(() => {
        if (dipilih || memuat || terpasang.length === 0) return;
        const utama = terpasang.find((c) => c.berjalan) || terpasang[0];
        bukaKamera(utama.camera_id);
    }, [dipilih, memuat, terpasang, bukaKamera]);

    /* Ringkasan disegarkan berkala supaya admin melihat angkanya benar-benar bertambah —
       itu satu-satunya bukti yang berarti bahwa penghitungnya bekerja. */
    useEffect(() => {
        if (!dipilih) return undefined;
        const t = setInterval(() => muatRingkasan(dipilih), 5000);
        return () => clearInterval(t);
    }, [dipilih, muatRingkasan]);

    const ubah = (kunci, nilai) => setDraft((s) => ({ ...s, [kunci]: nilai }));

    const simpan = async () => {
        if (!draft) return;
        setMenyimpan(true);
        try {
            // Disusun EKSPLISIT, bukan menyalin seluruh draft: daftar ini harus cocok persis
            // dengan skema rute. Field yang tidak terdaftar di sana akan DIHAPUS diam-diam oleh
            // Fastify dan panel terlihat "tidak menyimpan" tanpa pesan galat apa pun.
            const kirim = {
                aktif: Boolean(draft.aktif),
                label: draft.label || '',
                garis: draft.garis || [],
                arah_arus: draft.arah_arus || [1, 0],
                nama_arah: draft.nama_arah || {},
                model: draft.model,
                imgsz: draft.imgsz,
                conf: draft.conf,
                conf_gambar: draft.conf_gambar,
                fps: draft.fps,
                min_gerak: draft.min_gerak,
                min_umur: draft.min_umur,
            };
            const hasil = await vehicleCountAdminService.saveCamera(dipilih, kirim);
            setDraft((s) => ({ ...s, ...(hasil?.data || {}) }));
            showNotification(hasil?.message || 'Setelan tersimpan', 'success');
            muatDaftar();
        } catch (error) {
            showNotification(
                error?.response?.data?.message || 'Gagal menyimpan setelan', 'error',
            );
        } finally {
            setMenyimpan(false);
        }
    };

    const hapus = async () => {
        if (!dipilih) return;

        /*
         * Satu-satunya aksi merusak di seluruh permukaan admin yang tidak bertanya. Tombolnya
         * memakai KELAS_TOMBOL yang sama dengan dua tetangganya dan duduk di antara "Simpan
         * setelan" dan "Tutup" — satu salah pencet membuang geometri garis hitung, arah aliran,
         * model, imgsz, conf, fps dan sisanya, tanpa jalan kembali.
         */
        if (!(await confirm({
            title: 'Hapus detektor kamera ini?',
            message: 'Semua setelan detektornya — garis hitung, arah, model dan ambang — ikut hilang dan tidak bisa dikembalikan.',
            confirmLabel: 'Hapus',
            tone: 'danger',
        }))) return;

        try {
            await vehicleCountAdminService.removeCamera(dipilih);
            setDipilih(null);
            setDraft(null);
            showNotification('Setelan dihapus', 'success');
            muatDaftar();
        } catch {
            showNotification('Gagal menghapus setelan', 'error');
        }
    };

    const jumlahAktif = useMemo(
        () => terpasang.filter((c) => c.aktif).length, [terpasang],
    );

    return (
        <div className="flex flex-col gap-4">
            <header className="flex flex-col gap-1">
                <h1 className="text-xl font-semibold text-content">Hitung Kendaraan</h1>
                <p className="text-sm text-content-muted">
                    Nyalakan penghitungan otomatis di kamera mana pun, lalu gambar garis hitungnya
                    langsung di atas gambar kamera.
                </p>
            </header>

            <PanduanPanel
                judul="Panduan singkat"
                bagian={PANDUAN}
                catatan="Tiap penghitung memakai 4–6 dari 16 core di server ini. Satu kamera aman;
                         sebelum menyalakan yang ketiga, lihat dulu beban servernya."
            />

            {jumlahAktif >= BATAS_WAJAR && (
                <div className="rounded-card border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-xs text-status-warn">
                    {jumlahAktif} kamera menyala. Tiap penghitung memakai 4–6 dari 16 core, jadi
                    menambah lagi berisiko menekan layanan CCTV yang sedang dipakai pengunjung.
                </div>
            )}

            <section className="rounded-card border border-edge bg-surface p-3">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-subtle">
                    Kamera yang sudah diatur
                </h2>
                {memuat ? (
                    <p className="text-sm text-content-muted">Memuat…</p>
                ) : terpasang.length === 0 ? (
                    <p className="text-sm text-content-muted">Belum ada. Tambahkan di bawah.</p>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {terpasang.map((c) => (
                            <li key={c.camera_id}>
                                <button
                                    type="button"
                                    onClick={() => bukaKamera(c.camera_id)}
                                    className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-control px-2 py-2 text-left text-sm transition-colors hover:bg-surface-raised sm:min-h-0 ${dipilih === c.camera_id ? 'bg-surface-raised' : ''}`}
                                >
                                    <span className="flex min-w-0 items-center gap-2">
                                        <span className={`h-2 w-2 shrink-0 rounded-full ${c.berjalan ? 'bg-status-live' : 'bg-status-idle'}`} />
                                        <span className="truncate text-content">{c.nama_kamera || `Kamera ${c.camera_id}`}</span>
                                    </span>
                                    <span className="shrink-0 text-xs text-content-muted">
                                        {c.aktif ? (c.berjalan ? 'menghitung' : 'aktif, belum jalan') : 'mati'}
                                        {' · '}{(c.garis || []).length} garis
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="mt-3 flex flex-col gap-2 border-t border-edge pt-3 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                        <Baris
                            label="Tambah kamera"
                            anak={(
                                <select
                                    className={KELAS_INPUT}
                                    value={kameraBaru}
                                    onChange={(e) => setKameraBaru(e.target.value)}
                                >
                                    <option value="">Pilih kamera…</option>
                                    {tersedia.filter((c) => !c.sudah_diatur).map((c) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            )}
                            keterangan="Hanya kamera community yang aktif — kamera lain tidak pernah tampil di halaman publik."
                        />
                    </div>
                    <button
                        type="button"
                        className={KELAS_TOMBOL}
                        disabled={!kameraBaru}
                        onClick={() => { bukaKamera(Number(kameraBaru)); setKameraBaru(''); }}
                    >
                        Atur
                    </button>
                </div>
            </section>

            {draft && (
                <section className="flex flex-col gap-3 rounded-card border border-edge bg-surface p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-base font-semibold text-content">
                            {draft.label || `Kamera ${dipilih}`}
                        </h2>
                        <label className="flex items-center gap-2 text-sm text-content">
                            <input
                                type="checkbox"
                                checked={Boolean(draft.aktif)}
                                onChange={(e) => ubah('aktif', e.target.checked)}
                                className="h-5 w-5 rounded border-edge accent-[var(--primary-color)] sm:h-4 sm:w-4"
                            />
                            Nyalakan penghitungan
                        </label>
                    </div>

                    {/* Data hitungan ditaruh DI ATAS editor: yang pertama ingin diketahui admin
                        setelah membuka kamera adalah "apakah ini menghitung dan berapa",
                        bukan formulir setelannya. */}
                    {ringkasan ? (
                        <div className="rounded-card border border-edge bg-surface-sunken p-3">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <span className="text-2xl font-semibold tabular-nums text-content">
                                    {Number(ringkasan.total_10_menit || 0).toLocaleString('id-ID')}
                                </span>
                                <span className="text-xs text-content-muted">
                                    kendaraan dalam 10 menit terakhir
                                </span>
                                <span className="ml-auto text-xs text-content-subtle">
                                    {ringkasan.diperbarui}
                                </span>
                            </div>
                            <p className="mt-0.5 text-xs text-content-subtle">
                                <span className="tabular-nums">
                                    {Number(ringkasan.total || 0).toLocaleString('id-ID')}
                                </span> total sejak {ringkasan.mulai}
                            </p>

                            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {['motor', 'mobil', 'truk', 'bus'].map((k) => (
                                    <div key={k} className="min-w-0 rounded-control border border-edge bg-surface px-2 py-1.5">
                                        <dt className="truncate text-xs capitalize text-content-muted">{k}</dt>
                                        <dd className="text-base font-semibold tabular-nums text-content">
                                            {Number(ringkasan.total_jenis?.[k] || 0).toLocaleString('id-ID')}
                                        </dd>
                                    </div>
                                ))}
                            </dl>

                            <ul className="mt-2 flex flex-col gap-1">
                                {Object.entries(ringkasan.arah || {}).map(([nama, per]) => (
                                    <li key={nama} className="flex items-center justify-between gap-2 text-xs">
                                        <span className="min-w-0 truncate text-content-muted">{nama}</span>
                                        <span className="shrink-0 font-medium tabular-nums text-content">
                                            {Object.values(per).reduce((a, b) => a + b, 0).toLocaleString('id-ID')}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            {/* Angka operasional: inilah yang menjawab "sehat atau tidak", dan
                                sengaja hanya ada di sini — di halaman publik semuanya jargon. */}
                            <p className="mt-2 border-t border-edge pt-2 text-xs text-content-subtle">
                                {ringkasan.fps} fps · {Number(ringkasan.frame_diproses || 0).toLocaleString('id-ID')} frame ·
                                {' '}frame terakhir {ringkasan.umur_frame_terakhir_detik}s lalu ·
                                {' '}dijatuhkan {ringkasan.frame_dijatuhkan_sumber} ·
                                {' '}sambung ulang {ringkasan.sambung_ulang} ·
                                {' '}setelan dimuat ulang {ringkasan.setelan_dimuat_ulang ?? 0}× ·
                                {' '}{ringkasan.jumlah_garis} garis · {ringkasan.model}
                            </p>
                        </div>
                    ) : (
                        <p className="rounded-card border border-edge bg-surface-sunken px-3 py-2 text-xs text-content-muted">
                            Belum ada data hitungan untuk kamera ini. Gambar garis, nyalakan, lalu
                            angkanya akan muncul di sini dalam beberapa detik.
                        </p>
                    )}

                    <CountingLineEditor
                        previewUrl={`/api/thumbnails/${dipilih}.jpg`}
                        garis={draft.garis || []}
                        arahArus={draft.arah_arus}
                        namaArah={draft.nama_arah}
                        onChange={(g) => ubah('garis', g)}
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Baris
                            label="Nama arah A (searah panah hijau)"
                            anak={(
                                <input
                                    className={KELAS_INPUT}
                                    value={draft.nama_arah?.plus || ''}
                                    onChange={(e) => ubah('nama_arah', { ...draft.nama_arah, plus: e.target.value })}
                                />
                            )}
                        />
                        <Baris
                            label="Nama arah B (berlawanan)"
                            anak={(
                                <input
                                    className={KELAS_INPUT}
                                    value={draft.nama_arah?.minus || ''}
                                    onChange={(e) => ubah('nama_arah', { ...draft.nama_arah, minus: e.target.value })}
                                />
                            )}
                        />
                        <div className="sm:col-span-2">
                            <Baris
                                label="Arah A menghadap ke mana"
                                keterangan="Menentukan perlintasan masuk arah A atau B. Panah hijau di gambar menunjukkan arah A."
                                anak={(
                                    <div className="flex flex-wrap gap-1.5">
                                        {ARAH_CEPAT.map((a) => {
                                            const [x, y] = draft.arah_arus || [1, 0];
                                            // Sudut antara arah tersimpan dan preset; di bawah ~22°
                                            // dianggap preset itulah yang sedang dipakai.
                                            const pjg = Math.hypot(x, y) || 1;
                                            const terpilih = (x * a.nilai[0] + y * a.nilai[1]) / pjg > 0.92;
                                            return (
                                                <button
                                                    key={a.label}
                                                    type="button"
                                                    onClick={() => ubah('arah_arus', a.nilai)}
                                                    className={`min-h-[44px] flex-1 rounded-control border px-2 py-2 text-xs
                                                                transition-colors sm:min-h-0 ${terpilih
                                                            ? 'border-primary-500 bg-primary-500/10 text-content'
                                                            : 'border-edge text-content-muted hover:border-edge-strong'}`}
                                                >
                                                    <span aria-hidden="true" className="mr-1">{a.panah}</span>
                                                    {a.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            />
                            {/*
                              * Tombol arah TIDAK menggantikan angka persisnya, hanya menyembunyikannya.
                              * Perempatan Sosrodilogo memakai 0,90 / -0,44 — sekitar 26°, tidak jatuh
                              * pada satu pun dari delapan arah baku. Menghapus isian ini akan membuat
                              * sudut yang sudah disetel tidak bisa dikembalikan dari panel.
                              */}
                            <details className="mt-2">
                                <summary className="cursor-pointer text-xs text-content-muted">
                                    Sudut persis: {(draft.arah_arus?.[0] ?? 1).toFixed(2)},{' '}
                                    {(draft.arah_arus?.[1] ?? 0).toFixed(2)}
                                </summary>
                                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                    <Baris
                                        label="Arah arus X"
                                        anak={(
                                            <input
                                                type="number" step="0.01" className={KELAS_INPUT}
                                                value={draft.arah_arus?.[0] ?? 1}
                                                onChange={(e) => ubah('arah_arus', [Number(e.target.value), draft.arah_arus?.[1] ?? 0])}
                                            />
                                        )}
                                    />
                                    <Baris
                                        label="Arah arus Y"
                                        anak={(
                                            <input
                                                type="number" step="0.01" className={KELAS_INPUT}
                                                value={draft.arah_arus?.[1] ?? 0}
                                                onChange={(e) => ubah('arah_arus', [draft.arah_arus?.[0] ?? 1, Number(e.target.value)])}
                                            />
                                        )}
                                    />
                                </div>
                            </details>
                        </div>
                        <Baris
                            label="Model"
                            anak={(
                                <select className={KELAS_INPUT} value={draft.model || ''}
                                    onChange={(e) => ubah('model', e.target.value)}>
                                    {MODEL_PILIHAN.map((m) => (
                                        <option key={m.value} value={m.value}>{m.label}</option>
                                    ))}
                                </select>
                            )}
                        />
                        <Baris
                            label="Ukuran olah (imgsz)"
                            keterangan="Lebih besar TIDAK selalu lebih baik: pada kamera CCTV, 384–512 terukur mengalahkan 640."
                            anak={(
                                <input type="number" step="32" min="256" max="960" className={KELAS_INPUT}
                                    value={draft.imgsz ?? 448}
                                    onChange={(e) => ubah('imgsz', Number(e.target.value))} />
                            )}
                        />
                        <Baris
                            label="Ambang deteksi"
                            keterangan="Rendah = lebih peka melacak kendaraan kecil seperti motor."
                            anak={(
                                <input type="number" step="0.01" min="0.02" max="0.9" className={KELAS_INPUT}
                                    value={draft.conf ?? 0.1}
                                    onChange={(e) => ubah('conf', Number(e.target.value))} />
                            )}
                        />
                        <Baris
                            label="Ambang tampil kotak"
                            keterangan="Dipisah dari ambang deteksi: melacak butuh peka, menampilkan butuh rapi."
                            anak={(
                                <input type="number" step="0.05" min="0.05" max="0.95" className={KELAS_INPUT}
                                    value={draft.conf_gambar ?? 0.35}
                                    onChange={(e) => ubah('conf_gambar', Number(e.target.value))} />
                            )}
                        />
                        <Baris
                            label="FPS olah"
                            keterangan="Terlalu tinggi membuat penghitung tertinggal dari siaran."
                            anak={(
                                <input type="number" min="1" max="15" className={KELAS_INPUT}
                                    value={draft.fps ?? 8}
                                    onChange={(e) => ubah('fps', Number(e.target.value))} />
                            )}
                        />
                        <Baris
                            label="Gerak minimum (px)"
                            keterangan="Perpindahan bersih sebelum boleh dihitung — menyaring deteksi diam yang bergetar."
                            anak={(
                                <input type="number" min="5" max="400" className={KELAS_INPUT}
                                    value={draft.min_gerak ?? 45}
                                    onChange={(e) => ubah('min_gerak', Number(e.target.value))} />
                            )}
                        />
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-edge pt-3">
                        <button type="button" className={KELAS_TOMBOL} onClick={simpan} disabled={menyimpan}>
                            {menyimpan ? 'Menyimpan…' : 'Simpan setelan'}
                        </button>
                        <button type="button" className={KELAS_TOMBOL} onClick={hapus}>
                            Hapus dari daftar
                        </button>
                        <button type="button" className={KELAS_TOMBOL}
                            onClick={() => { setDipilih(null); setDraft(null); }}>
                            Tutup
                        </button>
                    </div>

                    <p className="text-xs text-content-subtle">
                        Perubahan dibaca penghitung tanpa perlu memulai ulang, jadi video di halaman
                        publik tidak terputus saat Anda menyimpan.
                    </p>
                </section>
            )}
        </div>
    );
}
