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
import vehicleCountAdminService from '../services/vehicleCountAdminService';
import CountingLineEditor from '../components/admin/vehicle-count/CountingLineEditor.jsx';

/*
 * `text-base sm:text-sm`, bukan `text-sm` saja: Safari iOS memperbesar seluruh halaman begitu
 * jari menyentuh input yang fontnya di bawah 16 px, dan pengguna harus mencubit untuk kembali.
 * Di layar lebar ukurannya kembali 14 px. Halaman ini memang dipakai dari HP di lapangan.
 */
const KELAS_INPUT = 'w-full rounded-control border border-edge bg-surface px-3 py-2 text-base sm:text-sm text-content transition-colors focus:border-edge-strong focus:outline-none';
const KELAS_TOMBOL = 'min-h-[44px] rounded-control border border-edge px-3 py-2 text-sm font-medium text-content transition-colors hover:border-edge-strong hover:bg-surface-raised sm:min-h-0';

/* Jumlah kamera yang realistis berjalan bersamaan di satu server 16 core. */
const BATAS_WAJAR = 3;

const MODEL_PILIHAN = [
    { value: 'kamera15-v1.pt', label: 'Khusus kamera ini (hasil latihan) — paling cepat & tepat' },
    { value: 'yolo11m.pt', label: 'yolo11m (umum, COCO)' },
    { value: 'yolo11s.pt', label: 'yolo11s (umum, lebih ringan)' },
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
                                    className={`flex w-full items-center justify-between gap-2 rounded-control px-2 py-2 text-left text-sm transition-colors hover:bg-surface-raised ${dipilih === c.camera_id ? 'bg-surface-raised' : ''}`}
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
