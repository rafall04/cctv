/*
 * Purpose: Admin page for Ronda Digital — add/remove detectors and tune every per-camera setting
 *          (watch window, Telegram group, cooldowns, object classes, sensitivity, mask zones,
 *          monitored area, processing resolution/rate) with a live preview of what the detector sees.
 * Caller: Protected admin route /admin/ronda (adminOnly).
 * Deps: React hooks, NotificationContext, ConfirmContext, rondaAdminService, Skeleton.
 * MainFuncs: RondaSettings.
 * SideEffects: Calls /api/admin/ronda/*.
 *
 * Soft settings reach the detector in ~15 s because it polls its own config file; settings marked
 * "perlu nyalakan ulang" only apply when the container is recreated, and the save response says so.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import rondaAdminService from '../services/rondaAdminService';
import RondaZoneEditor from '../components/admin/ronda/RondaZoneEditor';
import PanduanPanel from '../components/admin/PanduanPanel';
import { Button, Modal, PageHeader } from '../components/ui';
import { TableSkeleton } from '../components/ui/Skeleton';

const HOUR_PRESETS = [
    { label: '21:00–05:00', value: '21:00-05:00' },
    { label: '22:00–05:00', value: '22:00-05:00' },
    { label: '23:00–04:30', value: '23:00-04:30' },
    { label: '24 jam', value: '' },
];

/*
 * Ditulis dari kegagalan yang benar-benar terjadi saat memasang detektor pertama, bukan dari
 * daftar istilah: sumber yang tidak terbaca, peringatan yang terlalu sering, dan lampu status
 * yang disalahartikan sebagai "rusak".
 */
const PANDUAN = [
    {
        tanya: 'Bagaimana ronda ini bekerja?',
        jawab: 'Dua tahap. Pertama gerakan dideteksi dengan cara murah — itu berjalan terus. '
            + 'Baru kalau gerakannya bertahan beberapa detik, YOLO dipanggil untuk memastikan '
            + 'itu benar orang atau kendaraan, bukan daun atau bayangan. Peringatan Telegram '
            + 'hanya dikirim setelah tahap kedua lolos.',
    },
    {
        tanya: 'Area pantau dan zona abaikan',
        jawab: 'Tekan salah satu tombol mode di atas gambar, lalu ketuk gambarnya. "Area pantau" '
            + '(kuning) membatasi tempat yang diperiksa — dikosongkan berarti seluruh layar. '
            + '"Zona abaikan" (merah) mematikan bagian tertentu: jam di pojok, tulisan berjalan, '
            + 'atau jalan raya yang ramai sepanjang malam.',
    },
    {
        tanya: 'Arti warna lampu di sebelah nama kamera',
        jawab: 'Hijau = berjalan dan melihat gambar. Kuning = prosesnya hidup tetapi gambar '
            + 'kameranya tidak terbaca — biasanya alamat sumber berubah atau kameranya mati; '
            + 'jumlah percobaan sambung ulang ikut ditampilkan. Merah = detektornya tidak jalan.',
    },
    {
        tanya: 'Peringatannya terlalu sering',
        jawab: 'Berurutan, dari yang paling tidak berisiko: naikkan "Ukuran gerakan minimum", '
            + 'tambahkan zona abaikan di bagian yang selalu bergerak, persempit area pantau, '
            + 'baru terakhir naikkan jeda. Menaikkan jeda lebih dulu hanya menyembunyikan '
            + 'gejalanya — kejadiannya tetap terdeteksi, Anda saja yang tidak diberi tahu.',
    },
    {
        tanya: 'Tidak ada peringatan sama sekali',
        jawab: 'Periksa berurutan: lampu kamera hijau atau tidak, tanda centang "aktif" menyala, '
            + 'ID grup Telegram terisi, dan jam ronda memang sedang berlaku. Di luar jam ronda '
            + 'peringatan tetap dikirim, hanya jauh lebih jarang — itu jeda yang kedua.',
    },
    {
        tanya: 'Mana yang berlaku langsung, mana yang perlu nyalakan ulang?',
        jawab: 'Jam, jeda, grup Telegram, kepekaan, zona, dan nama berlaku sekitar 15 detik tanpa '
            + 'memutus apa pun. Resolusi olah, FPS, batas bingkai, dan retensi baru berlaku '
            + 'setelah "Nyalakan ulang" — pesan setelah menyimpan akan menyebutkannya.',
    },
];

const CLASS_PRESETS = [
    { label: 'Orang saja', value: 'person' },
    { label: 'Orang + kendaraan', value: 'person,bicycle,car,motorcycle,bus,truck' },
];

/*
 * `text-base sm:text-sm`: di bawah 16 px, Safari iOS memperbesar halaman saat input disentuh dan
 * pengguna harus mencubit untuk kembali. Halaman ronda justru paling sering dibuka dari HP —
 * orang mengubah jam siaga atau kepekaan saat sedang di luar, bukan di depan laptop.
 */
const inputClass =
    'w-full bg-surface-sunken border border-edge rounded-control px-3 py-2 text-content text-base sm:text-sm ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus:border-edge-strong';
const labelClass = 'block text-xs font-medium text-content-muted mb-1.5';
const hintClass = 'mt-1 text-[11px] text-content-subtle';
// min-h 40 px hanya di layar sempit: tombol-tombol ini sebelumnya setinggi 27-30 px, di bawah
// ukuran sasaran sentuh yang bisa ditekan dengan yakin sambil berdiri.
const btnGhost =
    'min-h-[40px] sm:min-h-0 rounded-control border border-edge px-3 py-1.5 text-xs text-content-muted ' +
    'hover:border-edge-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50';

function draftFrom(config) {
    return {
        label: config?.label ?? '',
        area: config?.area ?? '',
        enabled: config?.enabled !== false,
        alert_hours: config?.alert_hours ?? '',
        tg_cooldown: config?.tg_cooldown ?? 12,
        tg_cooldown_off: config?.tg_cooldown_off ?? 300,
        chat_id: config?.chat_id ?? '',
        confirm_classes: config?.confirm_classes ?? CLASS_PRESETS[1].value,
        min_area: config?.min_area ?? 700,
        confirm_conf: config?.confirm_conf ?? 0.15,
        proc_w: config?.proc_w ?? 960,
        target_fps: config?.target_fps ?? 5,
        crop_limit: config?.crop_limit ?? '0,0,1,1',
        retention_days: config?.retention_days ?? 7,
        max_snaps: config?.max_snaps ?? 50,
        ignore: JSON.stringify(config?.ignore ?? []),
        roi: JSON.stringify(config?.roi ?? []),
    };
}

/** Turns the two JSON textareas back into arrays, reporting which one is malformed. */
function parseZones(draft) {
    const out = {};
    for (const key of ['ignore', 'roi']) {
        try {
            const parsed = JSON.parse(draft[key] || '[]');
            if (!Array.isArray(parsed)) throw new Error('bukan daftar');
            out[key] = parsed;
        } catch {
            const label = key === 'ignore' ? 'Zona abaikan' : 'Area pantau';
            throw new Error(`${label} bukan JSON yang sah. Contoh: [[0,0,0.3,0.1]]`);
        }
    }
    return out;
}

/** Parse the JSON text fields, tolerating a half-typed value so the editor keeps rendering. */
function safeZones(draft) {
    const read = (raw) => {
        try {
            const parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };
    return { roi: read(draft?.roi), ignore: read(draft?.ignore) };
}

export function RondaSettings() {
    const { showNotification } = useNotification();
    const confirm = useConfirm();
    const [cameras, setCameras] = useState([]);
    const [availableCams, setAvailableCams] = useState([]);
    const [available, setAvailable] = useState(true);
    const [kesiapan, setKesiapan] = useState(null);
    const [loading, setLoading] = useState(true);
    const [drafts, setDrafts] = useState({});
    const [busy, setBusy] = useState(null);
    const [previewKey, setPreviewKey] = useState(0);
    const [adding, setAdding] = useState(false);
    const [newCam, setNewCam] = useState({ camera_id: '', area: '', chat_id: '', alert_hours: '21:00-05:00' });

    const load = useCallback(async () => {
        try {
            const [list, avail] = await Promise.all([
                rondaAdminService.getCameras(),
                rondaAdminService.getAvailableCameras().catch(() => ({ data: [] })),
            ]);
            const cams = list?.data?.cameras ?? [];
            setAvailable(list?.data?.available !== false);
            setKesiapan(list?.data?.kesiapan ?? null);
            setCameras(cams);
            setAvailableCams(avail?.data ?? []);
            setDrafts((prev) => {
                const next = { ...prev };
                cams.forEach((cam) => { if (!next[cam.name]) next[cam.name] = draftFrom(cam.config); });
                return next;
            });
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal memuat pengaturan ronda', 'error');
        } finally {
            setLoading(false);
        }
    }, [showNotification]);

    useEffect(() => {
        load();
        const timer = setInterval(load, 30000);
        return () => clearInterval(timer);
    }, [load]);

    const setField = (name, key, value) =>
        setDrafts((prev) => ({ ...prev, [name]: { ...prev[name], [key]: value } }));

    const act = async (key, fn, okMessage) => {
        setBusy(key);
        try {
            const res = await fn();
            showNotification(res?.message || okMessage, 'success');
            await load();
            setPreviewKey((k) => k + 1);
            return true;
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal', 'error');
            return false;
        } finally {
            setBusy(null);
        }
    };

    const save = async (name) => {
        let zones;
        try {
            zones = parseZones(drafts[name]);
        } catch (error) {
            showNotification(error.message, 'error');
            return;
        }
        // The two zone fields are edited as JSON text; send the parsed arrays instead of the strings.
        const rest = { ...drafts[name] };
        delete rest.ignore;
        delete rest.roi;
        await act(name, () => rondaAdminService.updateCamera(name, { ...rest, ...zones }), 'Tersimpan');
    };

    const restart = (name) =>
        act(`restart-${name}`, () => rondaAdminService.restartCamera(name), 'Dinyalakan ulang');

    const remove = async (name, label) => {
        const ok = await confirm({
            title: `Hapus "${label}" dari pemantauan?`,
            // `message`, not `body`: useConfirm reads `message` and silently drops anything else, so
            // this dialog was asking "Hapus?" with no consequences attached.
            message: 'Kamera berhenti dipantau dan peringatannya dimatikan. Foto yang sudah tersimpan tidak ikut dihapus.',
            confirmLabel: 'Hapus',
            tone: 'danger',
        });
        if (!ok) return;
        await act(`del-${name}`, () => rondaAdminService.deleteCamera(name), 'Dihapus');
    };

    const create = async () => {
        if (!newCam.camera_id) {
            showNotification('Pilih kamera dulu', 'error');
            return;
        }
        const done = await act('create', () => rondaAdminService.createCamera({
            camera_id: Number(newCam.camera_id),
            area: newCam.area,
            chat_id: newCam.chat_id,
            alert_hours: newCam.alert_hours,
        }), 'Kamera ditambahkan');
        if (done) {
            setNewCam({ camera_id: '', area: '', chat_id: '', alert_hours: '21:00-05:00' });
            setAdding(false);
        }
    };

    if (loading) return <TableSkeleton rows={4} />;

    return (
        <div className="space-y-4">
            <PageHeader
                title="Pengaturan Ronda"
                description="Tambah kamera, atur jam siaga, grup Telegram, area pantau, dan kepekaan. Sebagian besar perubahan berlaku sekitar 15 detik tanpa menyalakan ulang."
                /* Opens the dialog; it no longer flips to "Batal", because the dialog carries its
                   own Batal and the page behind it is inert while it is open. */
                actions={available && (
                    <Button variant="primary" onClick={() => setAdding(true)}>
                        + Tambah Kamera
                    </Button>
                )}
            />

            <PanduanPanel
                judul="Panduan singkat"
                bagian={PANDUAN}
                catatan="Satu detektor terukur memakai sekitar 28% dari satu core dan 162 MB RAM
                         di server ini (siang, lalu lintas ramai). Malam hari belum terukur —
                         nyalakan satu kamera dulu dan lihat bebannya sebelum menambah."
            />

            {!available && (
                <div className="rounded-card border border-status-warn/30 bg-status-warn/10 p-4 text-sm">
                    <p className="font-medium text-status-warn">
                        Layanan deteksi belum terpasang di server ini, jadi kamera belum bisa ditambahkan.
                    </p>
                    {kesiapan?.kurang?.length > 0 && (
                        <>
                            <p className="mt-2 text-content-muted">Yang belum tersedia:</p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-content-muted">
                                {kesiapan.kurang.map((k) => <li key={k}>{k}</li>)}
                            </ul>
                        </>
                    )}
                    <p className="mt-2 text-content-subtle">
                        Setelan tiap kamera yang sudah ada tetap bisa diubah dari halaman ini; yang
                        terhalang hanya menambah kamera baru dan menyalakan ulang detektor.
                    </p>
                </div>
            )}

            {available && kesiapan?.perlu_disetel?.length > 0 && (
                <div className="rounded-card border border-edge bg-surface-raised p-4 text-sm text-content-muted">
                    Detektornya sudah terpasang, tetapi masih ada yang perlu diisi:
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {kesiapan.perlu_disetel.map((k) => <li key={k}>{k}</li>)}
                    </ul>
                </div>
            )}

            {available && cameras.length === 0 && (
                <div className="rounded-card border border-edge bg-surface-raised p-4 text-sm text-content-muted">
                    Belum ada kamera yang dipantau. Klik “Tambah Kamera” untuk mulai.
                </div>
            )}

            {cameras.map((cam) => {
                const draft = drafts[cam.name] || draftFrom(cam.config);
                const online = cam.status?.online;
                // Detektor yang hidup tetapi tidak mendapat gambar bukan "aktif" dan bukan pula
                // "mati" — menyamakannya dengan salah satu dari keduanya menyembunyikan justru
                // kegagalan yang paling sering: alamat sumber yang tidak bisa dibuka.
                const butaSumber = online && cam.status?.sourceOk === false;
                const warnaTitik = butaSumber ? 'bg-status-warn' : (online ? 'bg-status-live' : 'bg-status-fault');
                return (
                    <section key={cam.name} className="rounded-card border border-edge bg-surface-raised p-4 shadow-e1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span
                                className={`h-2.5 w-2.5 flex-none rounded-full ${warnaTitik}`}
                                aria-hidden="true"
                            />
                            <h2 className="font-semibold text-content">{cam.config?.label || cam.name}</h2>
                            <span className="text-xs tabular-nums text-content-subtle">
                                {cam.config?.area ? `${cam.config.area} · ` : ''}
                                {butaSumber
                                    ? `berjalan, tetapi gambar kamera tidak terbaca — ${cam.status.reconnects ?? 0}× menyambung ulang`
                                    : (online ? `aktif · ${cam.status.eventsToday ?? 0} kejadian hari ini` : 'tidak aktif')}
                            </span>
                            <span className="ml-auto flex gap-2">
                                <button
                                    type="button"
                                    className={btnGhost}
                                    disabled={busy === `restart-${cam.name}`}
                                    onClick={() => restart(cam.name)}
                                >
                                    {busy === `restart-${cam.name}` ? 'Menyalakan…' : 'Nyalakan ulang'}
                                </button>
                                <button
                                    type="button"
                                    className={`${btnGhost} text-status-fault`}
                                    disabled={busy === `del-${cam.name}`}
                                    onClick={() => remove(cam.name, cam.config?.label || cam.name)}
                                >
                                    Hapus
                                </button>
                            </span>
                        </div>

                        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
                            <div>
                                <RondaZoneEditor
                                    name={cam.name}
                                    refreshKey={previewKey}
                                    {...safeZones(draft)}
                                    onChange={({ roi, ignore }) => {
                                        setField(cam.name, 'roi', JSON.stringify(roi));
                                        setField(cam.name, 'ignore', JSON.stringify(ignore));
                                    }}
                                />
                                <p className={hintClass}>
                                    Merah = zona diabaikan · Kuning = area pantau. Tekan Simpan setelah mengubah.
                                </p>
                            </div>

                            <div>
                                <label className="flex items-center gap-2 text-sm text-content">
                                    <input
                                        type="checkbox"
                                        checked={draft.enabled}
                                        onChange={(e) => setField(cam.name, 'enabled', e.target.checked)}
                                        className="h-5 w-5 rounded border-edge accent-[var(--primary-color)] sm:h-4 sm:w-4"
                                    />
                                    Kirim peringatan ke Telegram
                                </label>

                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <div className="sm:col-span-2">
                                        <label className={labelClass} htmlFor={`hours-${cam.name}`}>
                                            Jam ronda (siaga penuh)
                                        </label>
                                        <input
                                            id={`hours-${cam.name}`}
                                            className={inputClass}
                                            value={draft.alert_hours}
                                            placeholder="21:00-05:00"
                                            onChange={(e) => setField(cam.name, 'alert_hours', e.target.value)}
                                        />
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {HOUR_PRESETS.map((p) => (
                                                <button
                                                    key={p.label}
                                                    type="button"
                                                    onClick={() => setField(cam.name, 'alert_hours', p.value)}
                                                    className="min-h-[40px] rounded-control border border-edge px-3 py-1 text-[11px]
                                                               text-content-muted hover:border-edge-strong focus:outline-none
                                                               focus-visible:ring-2 focus-visible:ring-primary-500 sm:min-h-0 sm:px-2"
                                                >
                                                    {p.label}
                                                </button>
                                            ))}
                                        </div>
                                        <p className={hintClass}>Di luar jam ini peringatan tetap dikirim, hanya lebih jarang.</p>
                                    </div>

                                    <div>
                                        <label className={labelClass} htmlFor={`cd-${cam.name}`}>Jeda saat ronda (detik)</label>
                                        <input id={`cd-${cam.name}`} type="number" min="5" max="3600" className={inputClass}
                                            value={draft.tg_cooldown}
                                            onChange={(e) => setField(cam.name, 'tg_cooldown', Number(e.target.value))} />
                                    </div>
                                    <div>
                                        <label className={labelClass} htmlFor={`cdoff-${cam.name}`}>Jeda di luar ronda (detik)</label>
                                        <input id={`cdoff-${cam.name}`} type="number" min="0" max="86400" className={inputClass}
                                            value={draft.tg_cooldown_off}
                                            onChange={(e) => setField(cam.name, 'tg_cooldown_off', Number(e.target.value))} />
                                        <p className={hintClass}>0 = matikan di luar jam ronda.</p>
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label className={labelClass} htmlFor={`chat-${cam.name}`}>ID grup Telegram</label>
                                        <input id={`chat-${cam.name}`} className={inputClass} value={draft.chat_id}
                                            placeholder="-1001234567890"
                                            onChange={(e) => setField(cam.name, 'chat_id', e.target.value)} />
                                    </div>

                                    <div>
                                        <label className={labelClass} htmlFor={`cls-${cam.name}`}>Objek yang dilaporkan</label>
                                        <select id={`cls-${cam.name}`} className={inputClass} value={draft.confirm_classes}
                                            onChange={(e) => setField(cam.name, 'confirm_classes', e.target.value)}>
                                            {CLASS_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                                        </select>
                                        <p className={hintClass}>Area parkir sebaiknya &quot;Orang saja&quot;.</p>
                                    </div>
                                    <div>
                                        <label className={labelClass} htmlFor={`area-${cam.name}`}>Ukuran gerakan minimum</label>
                                        <input id={`area-${cam.name}`} type="number" min="100" max="200000" step="100"
                                            className={inputClass} value={draft.min_area}
                                            onChange={(e) => setField(cam.name, 'min_area', Number(e.target.value))} />
                                        <p className={hintClass}>Naikkan bila bayangan daun memicu peringatan.</p>
                                    </div>
                                </div>

                                <details className="mt-4 rounded-control border border-edge bg-surface-sunken p-3">
                                    <summary className="cursor-pointer text-sm font-medium text-content">
                                        Pengaturan lanjutan
                                    </summary>

                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                        <div>
                                            <label className={labelClass} htmlFor={`lbl-${cam.name}`}>Nama tampil</label>
                                            <input id={`lbl-${cam.name}`} className={inputClass} value={draft.label}
                                                onChange={(e) => setField(cam.name, 'label', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className={labelClass} htmlFor={`ar-${cam.name}`}>Nama area</label>
                                            <input id={`ar-${cam.name}`} className={inputClass} value={draft.area}
                                                onChange={(e) => setField(cam.name, 'area', e.target.value)} />
                                        </div>

                                        <div className="sm:col-span-2">
                                            <label className={labelClass} htmlFor={`ign-${cam.name}`}>
                                                Zona abaikan — jam/watermark/jalan tetangga
                                            </label>
                                            <textarea id={`ign-${cam.name}`} rows="2" className={`${inputClass} font-mono text-base sm:text-xs`}
                                                value={draft.ignore}
                                                onChange={(e) => setField(cam.name, 'ignore', e.target.value)} />
                                            <p className={hintClass}>
                                                Daftar kotak [x1,y1,x2,y2] dalam proporsi 0–1. Contoh: [[0,0,0.3,0.1]]
                                            </p>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <label className={labelClass} htmlFor={`roi-${cam.name}`}>
                                                Area pantau — kosongkan berarti seluruh gambar
                                            </label>
                                            <textarea id={`roi-${cam.name}`} rows="2" className={`${inputClass} font-mono text-base sm:text-xs`}
                                                value={draft.roi}
                                                onChange={(e) => setField(cam.name, 'roi', e.target.value)} />
                                            <p className={hintClass}>
                                                Titik-titik [x,y] membentuk poligon. Berguna bila batas lahan miring.
                                            </p>
                                        </div>

                                        <div>
                                            <label className={labelClass} htmlFor={`pw-${cam.name}`}>
                                                Lebar proses (piksel)
                                            </label>
                                            <input id={`pw-${cam.name}`} type="number" min="320" max="1920" step="64"
                                                className={inputClass} value={draft.proc_w}
                                                onChange={(e) => setField(cam.name, 'proc_w', Number(e.target.value))} />
                                            <p className={hintClass}>Turunkan untuk hemat CPU · perlu nyalakan ulang.</p>
                                        </div>
                                        <div>
                                            <label className={labelClass} htmlFor={`fps-${cam.name}`}>Laju proses (fps)</label>
                                            <input id={`fps-${cam.name}`} type="number" min="1" max="25"
                                                className={inputClass} value={draft.target_fps}
                                                onChange={(e) => setField(cam.name, 'target_fps', Number(e.target.value))} />
                                            <p className={hintClass}>Tuas CPU terbesar · perlu nyalakan ulang.</p>
                                        </div>

                                        <div>
                                            <label className={labelClass} htmlFor={`crop-${cam.name}`}>Batas bingkai foto</label>
                                            <input id={`crop-${cam.name}`} className={inputClass} value={draft.crop_limit}
                                                placeholder="0,0,1,1"
                                                onChange={(e) => setField(cam.name, 'crop_limit', e.target.value)} />
                                            <p className={hintClass}>Agar jalan tetangga tidak masuk foto · perlu nyalakan ulang.</p>
                                        </div>
                                        <div>
                                            <label className={labelClass} htmlFor={`conf-${cam.name}`}>Ambang keyakinan AI</label>
                                            <input id={`conf-${cam.name}`} type="number" min="0.05" max="0.9" step="0.05"
                                                className={inputClass} value={draft.confirm_conf}
                                                onChange={(e) => setField(cam.name, 'confirm_conf', Number(e.target.value))} />
                                            <p className={hintClass}>Turunkan bila orang nyata sering terlewat.</p>
                                        </div>

                                        <div>
                                            <label className={labelClass} htmlFor={`ret-${cam.name}`}>Simpan foto (hari)</label>
                                            <input id={`ret-${cam.name}`} type="number" min="1" max="90"
                                                className={inputClass} value={draft.retention_days}
                                                onChange={(e) => setField(cam.name, 'retention_days', Number(e.target.value))} />
                                        </div>
                                        <div>
                                            <label className={labelClass} htmlFor={`snap-${cam.name}`}>Maks foto tersimpan</label>
                                            <input id={`snap-${cam.name}`} type="number" min="5" max="5000"
                                                className={inputClass} value={draft.max_snaps}
                                                onChange={(e) => setField(cam.name, 'max_snaps', Number(e.target.value))} />
                                        </div>
                                    </div>
                                </details>

                                <button
                                    type="button"
                                    onClick={() => save(cam.name)}
                                    disabled={busy === cam.name}
                                    className="mt-4 w-full rounded-control bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white
                                               disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:w-auto"
                                >
                                    {busy === cam.name ? 'Menyimpan…' : 'Simpan'}
                                </button>
                            </div>
                        </div>
                    </section>
                );
            })}

            {adding && (
                <Modal
                    title="Tambah Kamera ke Pemantauan"
                    description="Kamera yang dipilih mulai dipantau begitu ini disimpan."
                    size="lg"
                    onClose={() => setAdding(false)}
                    /* dismissible={false}: a stray tap on the scrim would throw away the four fields
                       already typed, with nothing to undo it. Closing has to be deliberate. */
                    dismissible={false}
                    footer={(
                        <>
                            <Button onClick={() => setAdding(false)} disabled={busy === 'create'}>
                                Batal
                            </Button>
                            {availableCams.length > 0 && (
                                <Button
                                    type="submit"
                                    form="ronda-add-form"
                                    variant="primary"
                                    loading={busy === 'create'}
                                >
                                    {busy === 'create' ? 'Menyiapkan…' : 'Tambahkan & Mulai Pantau'}
                                </Button>
                            )}
                        </>
                    )}
                >
                    {availableCams.length === 0 ? (
                        <p className="text-sm text-content-muted">
                            Semua kamera komunitas sudah dipantau, atau belum ada kamera yang punya stream aktif.
                        </p>
                    ) : (
                        <form
                            id="ronda-add-form"
                            onSubmit={(e) => { e.preventDefault(); create(); }}
                            className="grid gap-3 sm:grid-cols-2"
                        >
                            <div className="min-w-0 sm:col-span-2">
                                <label className={labelClass} htmlFor="new-cam">Kamera</label>
                                <select
                                    id="new-cam"
                                    className={inputClass}
                                    value={newCam.camera_id}
                                    onChange={(e) => setNewCam((s) => ({ ...s, camera_id: e.target.value }))}
                                >
                                    <option value="">— pilih kamera —</option>
                                    {availableCams.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}{c.area ? ` — ${c.area}` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="min-w-0">
                                <label className={labelClass} htmlFor="new-area">Nama area (untuk pesan)</label>
                                <input
                                    id="new-area"
                                    className={inputClass}
                                    value={newCam.area}
                                    placeholder="RT 02 DANDER"
                                    onChange={(e) => setNewCam((s) => ({ ...s, area: e.target.value }))}
                                />
                            </div>
                            <div className="min-w-0">
                                <label className={labelClass} htmlFor="new-chat">ID grup Telegram</label>
                                <input
                                    id="new-chat"
                                    className={inputClass}
                                    value={newCam.chat_id}
                                    placeholder="-1001234567890"
                                    onChange={(e) => setNewCam((s) => ({ ...s, chat_id: e.target.value }))}
                                />
                            </div>
                            <div className="min-w-0 sm:col-span-2">
                                <label className={labelClass} htmlFor="new-hours">Jam ronda</label>
                                <input
                                    id="new-hours"
                                    className={inputClass}
                                    value={newCam.alert_hours}
                                    onChange={(e) => setNewCam((s) => ({ ...s, alert_hours: e.target.value }))}
                                />
                            </div>
                        </form>
                    )}
                </Modal>
            )}
        </div>
    );
}

export default RondaSettings;
