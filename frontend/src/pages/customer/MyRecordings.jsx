/*
 * Purpose: Customer "Rekaman" page — replay recordings from the customer's OWN cameras, so
 *          retrieving footage stops being a manual request to staff.
 * Caller: App.jsx /my/rekaman route inside CustomerLayout.
 * Deps: customerService (camera list), recordingService (segments + stream URL).
 * MainFuncs: MyRecordings.
 * SideEffects: Fetches segments; plays MP4 files.
 *
 * The server decides, not this page: every request carries scope=owner and the backend re-checks
 * that the caller owns the camera, that it is a rental camera, and that billing is active. This
 * page only asks — it cannot grant itself anything by passing a different id.
 *
 * WHY IT ASKS FOR A SLICE
 * `owner_full` reaches the Telegram archive as well as the disk, so an unscoped request is the
 * camera's ENTIRE history — ~1,400 segments / ~240 KB on production — rendered as one list. The
 * page asks for a range instead, and shows the whole span as a coverage strip so narrowing the
 * list can never hide a day that has no footage. Same split as the staff playback page.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import customerService from '../../services/customerService';
import { getSegments, getSegmentStreamUrl } from '../../services/recordingService';
import PlaybackCoverageStrip from '../../components/playback/PlaybackCoverageStrip';
import PlaybackRangePicker from '../../components/playback/PlaybackRangePicker';
import { rollingRange } from '../../utils/playbackDayRange';
import { readRecordingMutePreference, writeRecordingMutePreference } from '../../utils/recordingAudio';

const SCOPE = 'owner_full';

function formatWaktu(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatUkuran(bytes) {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/*
 * A saved file lands in a folder full of other downloads, so `20260812_124003.mp4` is useless the
 * moment it leaves this page. Camera name + timestamp survives that trip. Non-alphanumerics are
 * stripped rather than escaped: this string becomes a filename on the visitor's own machine.
 */
function namaUnduhan(camera, segment) {
    const slug = String(camera?.name || 'kamera')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'kamera';
    const waktu = String(segment?.start_time || segment?.created_at || '')
        .replace(/[^0-9]/g, '')
        .slice(0, 14);
    return waktu ? `${slug}-${waktu}.mp4` : `${slug}.mp4`;
}

export default function MyRecordings() {
    const [cameras, setCameras] = useState([]);
    const [aktif, setAktif] = useState(null);
    const [segments, setSegments] = useState([]);
    const [coverage, setCoverage] = useState(null);
    const [rentang, setRentang] = useState(() => rollingRange());
    const [diputar, setDiputar] = useState(null);
    const [loading, setLoading] = useState(true);
    const [memuatSegmen, setMemuatSegmen] = useState(false);
    const [pesan, setPesan] = useState(null);
    const [tautan, setTautan] = useState([]);
    const [sibukTautan, setSibukTautan] = useState(false);
    // Rekaman kini membawa mikrofon kamera. `autoPlay` pada elemen ber-audio justru
    // DIBLOKIR kebijakan browser, dan `key={diputar.filename}` me-remount pemutar tiap klik
    // — jadi default tanpa mute berarti satu blokiran per segmen. Mulai dari preferensi yang
    // diingat (bisu kecuali diminta lain), lalu ikuti kontrol native.
    const [bisu, setBisu] = useState(readRecordingMutePreference);

    useEffect(() => {
        customerService.getMyCameras()
            .then((res) => {
                const semua = res?.data ?? res ?? [];
                // Only cameras that actually record can have anything to replay.
                const merekam = semua.filter((c) => c.enable_recording === 1);
                setCameras(merekam);
                setAktif(merekam[0]?.id ?? null);
            })
            .catch(() => setPesan({ tipe: 'error', teks: 'Gagal memuat daftar kamera.' }))
            .finally(() => setLoading(false));
    }, []);

    const muatSegmen = useCallback(async (cameraId, slice) => {
        if (!cameraId) return;
        setMemuatSegmen(true);
        setDiputar(null);
        setPesan(null);
        try {
            const res = await getSegments(cameraId, undefined, {}, SCOPE, slice);
            // The endpoint answers { data: { segments, total_segments, coverage, playback_policy } }
            // — not a bare array. Assuming the array crashed this page on first render, which is
            // exactly what a browser walk catches and a passing unit suite does not.
            const daftar = res?.data?.segments ?? [];
            const peta = res?.data?.coverage ?? null;
            setSegments(daftar);
            setCoverage(peta);
            if (daftar.length === 0) {
                /*
                 * "Belum ada rekaman" and "none in the range you picked" are different facts, and
                 * saying the first when the second is true would tell an owner their footage does
                 * not exist. The coverage map is what tells them apart.
                 */
                setPesan(peta?.runs?.length
                    ? { tipe: 'info', teks: 'Tidak ada rekaman pada rentang ini. Pilih tanggal lain, atau klik bagian hijau pada peta di atas.' }
                    : { tipe: 'info', teks: 'Belum ada rekaman tersimpan untuk kamera ini.' });
            }
        } catch (err) {
            setSegments([]);
            setCoverage(null);
            const status = err?.response?.status;
            setPesan({
                tipe: 'error',
                teks: status === 403
                    ? 'Rekaman kamera ini sedang tidak bisa diakses. Periksa status langganan Anda.'
                    : 'Gagal memuat rekaman.',
            });
        } finally {
            setMemuatSegmen(false);
        }
    }, []);

    useEffect(() => { muatSegmen(aktif, rentang); }, [aktif, rentang, muatSegmen]);

    // The picker hands back null for its rolling preset; rebuild it so the window is measured from
    // now rather than from whenever the page happened to load.
    const gantiRentang = useCallback((next) => setRentang(next || rollingRange()), []);

    const muatTautan = useCallback(() => {
        customerService.getPlaybackTokens()
            .then((res) => setTautan(res?.data ?? []))
            .catch(() => { /* daftar tautan opsional; halaman tetap berguna tanpanya */ });
    }, []);

    useEffect(() => { muatTautan(); }, [muatTautan]);

    const buatTautan = async () => {
        if (!aktif) return;
        setSibukTautan(true);
        try {
            const kamera = cameras.find((c) => c.id === aktif);
            const res = await customerService.createPlaybackToken({
                label: `Rekaman ${kamera?.name || ''}`.trim(),
                camera_ids: [aktif],
                playback_window_hours: 24,
            });
            // The full link is returned once and never again — it is stored hashed.
            const kunci = res?.data?.share_url || res?.data?.token || res?.data?.share_key;
            setPesan({
                tipe: 'info',
                teks: kunci
                    ? `Tautan dibuat. Salin sekarang, hanya ditampilkan sekali: ${kunci}`
                    : 'Tautan dibuat.',
            });
            muatTautan();
        } catch (err) {
            setPesan({ tipe: 'error', teks: err?.response?.data?.message || 'Gagal membuat tautan.' });
        } finally {
            setSibukTautan(false);
        }
    };

    const cabutTautan = async (id) => {
        try {
            await customerService.revokePlaybackToken(id);
            setPesan({ tipe: 'info', teks: 'Tautan dicabut.' });
            muatTautan();
        } catch {
            setPesan({ tipe: 'error', teks: 'Gagal mencabut tautan.' });
        }
    };

    if (loading) return <p className="text-sm text-content-muted">Memuat…</p>;

    if (cameras.length === 0) {
        return (
            <div className="rounded-card border border-edge bg-surface p-6 text-sm text-content-muted">
                <h1 className="mb-2 text-lg font-bold text-content">Rekaman</h1>
                <p>
                    Belum ada kamera Anda yang merekam. Rekaman adalah layanan tambahan di atas
                    harga tonton — hubungi kami untuk mengaktifkannya, atau lihat rinciannya di{' '}
                    <Link to="/my/paket" className="text-primary underline">halaman Paket</Link>.
                </p>
            </div>
        );
    }

    // `aktif` holds the camera id, not the row — the download filename needs the name.
    const kameraAktif = cameras.find((c) => c.id === aktif) || null;

    return (
        <div className="flex flex-col gap-4">
            <header className="flex flex-col gap-1">
                <h1 className="text-xl font-bold text-content sm:text-2xl">Rekaman</h1>
                <p className="text-sm text-content-muted">
                    Rekaman dari kamera Anda sendiri. Hanya Anda yang bisa membukanya.
                </p>
            </header>

            {cameras.length > 1 && (
                <div className="flex flex-wrap gap-2">
                    {cameras.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => setAktif(c.id)}
                            className={`rounded-control px-3 py-2 text-sm font-medium transition-colors ${
                                aktif === c.id ? 'bg-primary text-white' : 'border border-edge bg-surface text-content-muted hover:bg-surface-sunken'
                            }`}
                        >
                            {c.name}
                        </button>
                    ))}
                </div>
            )}

            {diputar && (
                <div className="overflow-hidden rounded-card border border-edge bg-black">
                    <video
                        key={diputar.filename}
                        src={getSegmentStreamUrl(aktif, diputar.filename, SCOPE, diputar)}
                        controls
                        autoPlay
                        muted={bisu}
                        playsInline
                        // Penjaga kesetaraan membuang gema React menulis `muted` kembali ke
                        // elemen — itu juga memicu volumechange, dan tanpa ini tiap ganti
                        // bisu memakan satu render tambahan tanpa kabar baru.
                        onVolumeChange={(e) => {
                            const m = e.currentTarget.muted;
                            if (m === bisu) return;
                            setBisu(m);
                            writeRecordingMutePreference(m);
                        }}
                        // `autoPlay` sendirian tak memberi cara mengamati penolakan. Meminta
                        // secara eksplisit membuat preferensi tanpa-bisu turun jadi pemutar
                        // ter-pause dengan kontrol terlihat, bukan klip yang diam tak jalan.
                        // `?.catch?.` karena play() tak dijamin mengembalikan Promise.
                        onCanPlay={(e) => e.currentTarget.play?.()?.catch?.(() => {})}
                        className="max-h-[60vh] w-full"
                    />
                    <p className="bg-surface px-4 py-2 text-xs text-content-muted">
                        {formatWaktu(diputar.start_time || diputar.created_at)}
                    </p>
                </div>
            )}

            {pesan && (
                <p className={`rounded-control border p-3 text-sm ${
                    pesan.tipe === 'error'
                        ? 'border-status-fault/40 bg-status-fault/5 text-content'
                        : 'border-edge bg-surface text-content-muted'
                }`}>
                    {pesan.teks}
                </p>
            )}

            <section className="rounded-card border border-edge bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 className="font-semibold text-content">Bagikan rekaman</h2>
                        <p className="text-xs text-content-muted">
                            Tautan untuk pegawai Anda atau untuk laporan — berlaku terbatas dan bisa
                            dicabut kapan saja.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={buatTautan}
                        disabled={sibukTautan}
                        className="rounded-control bg-primary px-3 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
                    >
                        {sibukTautan ? 'Membuat…' : '+ Buat tautan'}
                    </button>
                </div>

                {tautan.length > 0 && (
                    <ul className="mt-3 divide-y divide-edge border-t border-edge">
                        {tautan.map((t) => (
                            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                <span className="min-w-0">
                                    <span className="block truncate text-sm text-content">{t.label}</span>
                                    <span className="block text-xs text-content-subtle">
                                        {t.is_active ? `berlaku ${t.playback_window_hours} jam · dipakai ${t.use_count || 0}×` : 'sudah tidak berlaku'}
                                    </span>
                                </span>
                                {t.is_active && (
                                    <button
                                        type="button"
                                        onClick={() => cabutTautan(t.id)}
                                        className="shrink-0 text-xs font-medium text-status-fault hover:underline"
                                    >
                                        Cabut
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <div className="rounded-card border border-edge bg-surface">
                <div className="flex items-center justify-between border-b border-edge px-4 py-3">
                    <h2 className="font-semibold text-content">Potongan tersedia</h2>
                    <span className="text-xs text-content-muted">
                        {memuatSegmen ? 'Memuat…' : `${segments.length} potongan`}
                    </span>
                </div>

                {/*
                  * The strip speaks for the days the list is NOT showing, so it is never filtered by
                  * the picker beside it — that is the whole reason narrowing the list is safe.
                  */}
                <div className="border-b border-edge px-4 pt-4">
                    <PlaybackCoverageStrip
                        coverage={coverage}
                        range={rentang}
                        onRangeChange={gantiRentang}
                    />
                    <PlaybackRangePicker range={rentang} onRangeChange={gantiRentang} coverage={coverage} />
                </div>
                <ul className="divide-y divide-edge">
                    {segments.map((s) => (
                        <li key={s.id ?? s.filename} className="flex items-center gap-1 pr-2 transition-colors hover:bg-surface-sunken">
                            <button
                                type="button"
                                onClick={() => setDiputar(s)}
                                className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate text-sm text-content">
                                        {formatWaktu(s.start_time || s.created_at)}
                                    </span>
                                    <span className="block text-xs text-content-subtle">
                                        {formatUkuran(s.file_size)}
                                        {/* Older footage lives only in the cloud archive; say so rather
                                            than let a slower load look like a fault. */}
                                        {s.source === 'archive' ? ' · dari arsip cloud' : ''}
                                    </span>
                                </span>
                                <span className="shrink-0 text-xs font-medium text-primary">Putar</span>
                            </button>
                            {/*
                              * Same URL the player uses — the owner scope already authorises it, so
                              * this needs no new endpoint. It exists because "you can watch it" and
                              * "you can keep a copy" are different promises, and the second is the
                              * one a customer needs when handing footage to somebody else.
                              */}
                            <a
                                href={getSegmentStreamUrl(aktif, s.filename, SCOPE, s)}
                                download={namaUnduhan(kameraAktif, s)}
                                className="shrink-0 rounded-control border border-edge px-2.5 py-1.5 text-xs font-medium text-content-muted transition-colors hover:border-edge-strong hover:bg-surface-raised hover:text-content"
                            >
                                Unduh
                            </a>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
