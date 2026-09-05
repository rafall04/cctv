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
import RondaCameraCard from '../components/admin/ronda/RondaCameraCard';
import {
    PERF_PRESETS, draftFrom, parseZones, inputClass, labelClass, hintClass,
} from '../components/admin/ronda/rondaFormKit';
import PanduanPanel from '../components/admin/PanduanPanel';
import { Button, Modal, PageHeader } from '../components/ui';
import { TableSkeleton } from '../components/ui/Skeleton';

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

// Beri jeda antar restart pada aksi massal: menyalakan ulang 6 detektor serentak pernah memuncakkan
// beban server ke ~10. Bergiliran menjaga lonjakan tetap datar tanpa mengorbankan hasil akhir.
const RESTART_STAGGER_MS = 9000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // Kamera yang setelan strukturalnya sudah TERSIMPAN tetapi belum berlaku sampai dinyalakan ulang.
    // Harus disimpan di state (bukan diturunkan dari draft): setelah reload, config == draft padahal
    // container yang berjalan masih memakai nilai lama. Sumber kebenaran = respons `needsRestart`.
    const [pendingRestart, setPendingRestart] = useState({});
    const [restartProgress, setRestartProgress] = useState(null);

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

    // Set beberapa field sekaligus (mis. preset performa mengubah proc_w + target_fps atomik).
    const setFields = (name, patch) =>
        setDrafts((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));

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
        setBusy(name);
        try {
            const res = await rondaAdminService.updateCamera(name, { ...rest, ...zones });
            showNotification(res?.message || 'Tersimpan', 'success');
            // Perubahan struktural tersimpan tapi belum berlaku → munculkan banner nyala-ulang.
            if (res?.data?.needsRestart) setPendingRestart((prev) => ({ ...prev, [name]: true }));
            await load();
            setPreviewKey((k) => k + 1);
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal', 'error');
        } finally {
            setBusy(null);
        }
    };

    const restart = async (name) => {
        const ok = await act(`restart-${name}`, () => rondaAdminService.restartCamera(name), 'Dinyalakan ulang');
        if (ok) setPendingRestart((prev) => ({ ...prev, [name]: false }));
    };

    /*
     * Terapkan satu preset performa ke SEMUA kamera sekaligus, lalu kumpulkan mana yang perlu nyala
     * ulang. Menyimpan berurutan (bukan paralel) supaya penulisan config tidak saling menimpa dan
     * pesan galat tetap bisa ditelusuri per kamera.
     */
    const applyPresetToAll = async (preset) => {
        if (cameras.length === 0) return;
        const ok = await confirm({
            title: `Terapkan preset "${preset.label}" ke semua kamera?`,
            message: `${cameras.length} kamera akan diatur ke lebar proses ${preset.proc_w} px dan `
                + `${preset.target_fps} fps. Ini setelan struktural — berlaku setelah tiap kamera `
                + 'dinyalakan ulang. Setelah tersimpan, Anda bisa menyalakannya bergiliran dari banner di atas.',
            confirmLabel: 'Terapkan ke semua',
        });
        if (!ok) return;
        setBusy('apply-all');
        const need = [];
        try {
            for (const cam of cameras) {
                const res = await rondaAdminService.updateCamera(cam.name, {
                    proc_w: preset.proc_w,
                    target_fps: preset.target_fps,
                });
                if (res?.data?.needsRestart) need.push(cam.name);
            }
            setPendingRestart((prev) => {
                const next = { ...prev };
                need.forEach((n) => { next[n] = true; });
                return next;
            });
            showNotification(
                need.length > 0
                    ? `Preset "${preset.label}" tersimpan. ${need.length} kamera menunggu nyala ulang.`
                    : `Preset "${preset.label}" sudah aktif di semua kamera.`,
                'success',
            );
            await load();
            setPreviewKey((k) => k + 1);
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal menerapkan ke semua kamera', 'error');
        } finally {
            setBusy(null);
        }
    };

    /*
     * Nyalakan ulang semua kamera yang menunggu — BERGILIRAN dengan jeda, karena menyalakan ulang
     * banyak detektor serentak memuncakkan beban server. Setiap kamera yang berhasil langsung lepas
     * dari daftar tunggu agar tidak dinyalakan dua kali bila ada yang gagal di tengah jalan.
     */
    const restartPending = async () => {
        const names = cameras
            .map((c) => c.name)
            .filter((n) => pendingRestart[n]);
        if (names.length === 0) return;
        setBusy('restart-all');
        let done = 0;
        try {
            for (const name of names) {
                setRestartProgress({ done, total: names.length });
                try {
                    await rondaAdminService.restartCamera(name);
                    setPendingRestart((prev) => ({ ...prev, [name]: false }));
                } catch (error) {
                    showNotification(
                        `Gagal menyalakan ulang ${name}: ${error.response?.data?.message || 'coba lagi'}`,
                        'error',
                    );
                }
                done += 1;
                if (done < names.length) await sleep(RESTART_STAGGER_MS);
            }
            setRestartProgress({ done, total: names.length });
            showNotification(`${done} kamera dinyalakan ulang bergiliran.`, 'success');
            await load();
            setPreviewKey((k) => k + 1);
        } finally {
            setRestartProgress(null);
            setBusy(null);
        }
    };

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

    const pendingNames = cameras.map((c) => c.name).filter((n) => pendingRestart[n]);

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

            {/* Banner paling menonjol: setelan struktural yang tersimpan tapi belum berlaku. Ditaruh
                di puncak halaman supaya operator tidak bingung "kenapa tidak ada bedanya". */}
            {pendingNames.length > 0 && (
                <div className="rounded-card border border-status-warn/40 bg-status-warn/10 p-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-status-warn">
                                {pendingNames.length} kamera menunggu dinyalakan ulang
                            </p>
                            <p className="mt-0.5 text-xs text-content-muted">
                                Setelan lanjutan (lebar proses / fps / batas bingkai / retensi) sudah tersimpan,
                                tetapi baru berlaku setelah kamera dinyalakan ulang.
                                {restartProgress
                                    ? ` Sedang menyalakan ${restartProgress.done}/${restartProgress.total}…`
                                    : ' Dilakukan bergiliran agar beban server tidak melonjak.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={restartPending}
                            disabled={busy === 'restart-all'}
                            className="min-h-[40px] flex-none rounded-control bg-status-warn px-4 py-2 text-sm font-semibold
                                       text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-warn"
                        >
                            {busy === 'restart-all'
                                ? `Menyalakan ${restartProgress?.done ?? 0}/${restartProgress?.total ?? pendingNames.length}…`
                                : `Nyalakan ulang ${pendingNames.length} kamera (bergiliran)`}
                        </button>
                    </div>
                </div>
            )}

            {/* Preset performa untuk SEMUA kamera sekaligus — tuas cepat memberi ruang CPU saat
                server ramai, tanpa membuka setiap kartu satu per satu. */}
            {available && cameras.length > 1 && (
                <div className="rounded-card border border-edge bg-surface-raised p-4 shadow-e1">
                    <p className="text-sm font-semibold text-content">Performa semua kamera</p>
                    <p className="mt-0.5 text-xs text-content-muted">
                        Atur lebar proses dan laju olah untuk seluruh {cameras.length} kamera dalam satu klik.
                        Berlaku setelah nyala ulang.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {PERF_PRESETS.map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => applyPresetToAll(p)}
                                disabled={busy === 'apply-all'}
                                className="rounded-control border border-edge bg-surface-sunken px-3 py-2 text-left
                                           hover:border-edge-strong focus:outline-none focus-visible:ring-2
                                           focus-visible:ring-primary-500 disabled:opacity-60"
                            >
                                <span className="block text-sm font-medium text-content">
                                    {busy === 'apply-all' ? 'Menyimpan…' : p.label}
                                </span>
                                <span className="mt-0.5 block text-[11px] tabular-nums text-content-subtle">
                                    {p.proc_w}px · {p.target_fps} fps
                                </span>
                            </button>
                        ))}
                    </div>
                    <p className={hintClass}>
                        Untuk menyetel satu kamera saja, pakai preset di dalam “Pengaturan lanjutan” tiap kartu.
                    </p>
                </div>
            )}

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

            {cameras.map((cam) => (
                <RondaCameraCard
                    key={cam.name}
                    cam={cam}
                    draft={drafts[cam.name]}
                    busy={busy}
                    pending={!!pendingRestart[cam.name]}
                    previewKey={previewKey}
                    onField={setField}
                    onFields={setFields}
                    onSave={save}
                    onRestart={restart}
                    onRemove={remove}
                />
            ))}

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
