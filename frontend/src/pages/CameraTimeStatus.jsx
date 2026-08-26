/*
 * Purpose: Perlihatkan keadaan jam setiap kamera, dan sediakan jalan darurat kredensial ONVIF.
 * Caller: rute admin /admin/jam-kamera.
 * Deps: apiClient, komponen ui bersama, NotificationContext.
 *
 * KENAPA HALAMAN INI ADA
 * ----------------------
 * Penyelaras waktu berjalan sendiri tiap jam dan sudah memperbaiki apa yang bisa diperbaiki.
 * Tapi sampai halaman ini ada, ia BUTA dari sisi operator: satu-satunya jalur laporan adalah
 * log systemd yang tidak akan dibuka siapa pun, dan Telegram yang bisa saja belum dikonfigurasi.
 *
 * Itu persis bentuk kegagalan yang fitur ini dibuat untuk mengakhiri — lima kamera berhenti di
 * tahun 1970 entah sejak kapan, karena tidak ada satu pun permukaan yang menampilkannya.
 *
 * KENAPA TIDAK ADA TOMBOL "PERIKSA SEKARANG"
 * ------------------------------------------
 * Pemeriksaan berbicara langsung ke perangkat keras lewat ONVIF/ISAPI. Satu tombol yang bisa
 * ditekan berulang-ulang berarti belasan kamera dibanjiri panggilan oleh siapa pun yang tidak
 * sabar menunggu. Timer per jam sudah menjaga semuanya; halaman ini menunjukkan hasilnya.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../services/apiClient';
import { useNotification } from '../contexts/NotificationContext';
import {
    Button, Modal, ModalFooter, PageHeader,
    TableShell, Table, THead, TBody, TR, TH, TD,
} from '../components/ui';

const KREDENSIAL_FORM_ID = 'onvif-credentials-form';

/** Terjemahkan selisih detik jadi kalimat yang bisa dibaca tanpa berhitung. */
function ucapkanSelisih(detik) {
    if (detik === null || detik === undefined) return '—';
    const abs = Math.abs(detik);
    if (abs <= 2) return 'tepat';
    if (abs < 60) return `${detik > 0 ? '+' : '−'}${abs} detik`;
    if (abs < 3600) return `${detik > 0 ? '+' : '−'}${Math.round(abs / 60)} menit`;
    if (abs < 86400) return `${detik > 0 ? '+' : '−'}${Math.round(abs / 3600)} jam`;
    return `${detik > 0 ? '+' : '−'}${Math.round(abs / 86400)} hari`;
}

function ucapkanUmur(menit) {
    if (menit === null || menit === undefined) return 'belum pernah';
    if (menit < 1) return 'baru saja';
    if (menit < 60) return `${menit} menit lalu`;
    if (menit < 1440) return `${Math.round(menit / 60)} jam lalu`;
    return `${Math.round(menit / 1440)} hari lalu`;
}

/*
 * Metode yang dipakai penyelaras, dijelaskan dalam kalimat — bukan istilah teknisnya. Yang perlu
 * dipahami operator adalah satu hal: apakah kamera ini menjaga waktunya SENDIRI, atau server yang
 * terus menulisinya. Yang kedua tetap sehat, tapi bergantung pada server tetap hidup.
 */
const PENJELASAN_METODE = {
    onvif: 'Menarik sendiri dari server (ONVIF)',
    isapi: 'Menarik sendiri dari server (ISAPI)',
    dorong: 'Tanpa klien NTP — jam ditulis server',
};

function LencanaStatus({ kamera }) {
    if (kamera.stale) {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-content-muted">
                <span className="h-2 w-2 rounded-full bg-content-subtle" aria-hidden="true" />
                Belum diketahui
            </span>
        );
    }
    if (!kamera.reachable) {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-content-muted">
                <span className="h-2 w-2 rounded-full bg-content-subtle" aria-hidden="true" />
                Tak terjangkau
            </span>
        );
    }
    if (kamera.healthy) {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-status-live">
                <span className="h-2 w-2 rounded-full bg-status-live" aria-hidden="true" />
                Selaras
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-status-warn">
            <span className="h-2 w-2 rounded-full bg-status-warn" aria-hidden="true" />
            Perlu perhatian
        </span>
    );
}

export function CameraTimeStatus() {
    const { showNotification } = useNotification();
    const [cameras, setCameras] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [gagalMuat, setGagalMuat] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ username: '', password: '' });
    const [saving, setSaving] = useState(false);

    const muat = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await apiClient.get('/api/admin/camera-time');
            setCameras(data?.data?.cameras || []);
            setSummary(data?.data?.summary || null);
            setGagalMuat(false);
        } catch (error) {
            setGagalMuat(true);
            showNotification({
                type: 'error',
                title: 'Gagal memuat status jam kamera',
                message: error?.response?.data?.message || error.message,
            });
        } finally {
            setLoading(false);
        }
    }, [showNotification]);

    useEffect(() => {
        muat();
    }, [muat]);

    const bermasalah = useMemo(
        () => cameras.filter((c) => !c.healthy),
        [cameras],
    );

    const bukaEditor = (kamera) => {
        // Sandi tidak pernah dikirim ke panel, jadi kolomnya selalu mulai kosong — dan kosong
        // di sini berarti "kosongkan", bukan "biarkan". Itu dijelaskan di dalam dialognya.
        setForm({ username: '', password: '' });
        setEditing(kamera);
    };

    const simpanKredensial = async (event) => {
        event.preventDefault();
        if (!editing) return;
        setSaving(true);
        try {
            const { data } = await apiClient.put(
                `/api/admin/camera-time/${editing.id}/onvif-credentials`,
                { username: form.username, password: form.password },
            );
            showNotification({ type: 'success', title: data?.message || 'Tersimpan' });
            setEditing(null);
            await muat();
        } catch (error) {
            showNotification({
                type: 'error',
                title: 'Gagal menyimpan kredensial',
                message: error?.response?.data?.message || error.message,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-5">
            <PageHeader
                eyebrow="Operasi"
                title="Jam Kamera"
                description="Jam kamera diselaraskan otomatis tiap jam. Halaman ini menunjukkan hasilnya."
            />

            {/*
              * Ringkasan menyebut KAPAN pemeriksaan terakhir, bukan hanya berapa yang sehat.
              * Tanpa itu, panel yang menampilkan angka bagus dari data seminggu lalu terlihat
              * persis sama dengan panel yang benar-benar sehat.
              */}
            {summary && !gagalMuat && (
                <div className="rounded-card border border-edge bg-surface p-4">
                    {!summary.syncerEverRan ? (
                        <p className="text-sm text-status-warn">
                            Penyelaras waktu belum pernah berjalan di server ini. Jalankan
                            <code className="mx-1 rounded bg-surface-raised px-1.5 py-0.5 text-xs">
                                sudo bash deployment/camera-time/setup.sh
                            </code>
                            sekali, dan sisanya berjalan sendiri.
                        </p>
                    ) : (
                        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
                            <span className="text-content">
                                <strong className="text-lg">{summary.healthy}</strong>
                                <span className="text-content-muted"> dari {summary.total} selaras</span>
                            </span>
                            {summary.problems > 0 && (
                                <span className="text-status-warn">{summary.problems} perlu perhatian</span>
                            )}
                            <span className="text-content-muted">
                                Diperiksa {ucapkanUmur(summary.lastCheckAgeMinutes)}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {loading && <p className="text-sm text-content-muted">Memuat…</p>}

            {gagalMuat && !loading && (
                <p className="text-sm text-status-fault">
                    Status tidak bisa diambil. Angka apa pun di bawah tidak bisa dipercaya.
                </p>
            )}

            {!loading && !gagalMuat && (
                <TableShell>
                    <Table>
                        <THead>
                            <TR>
                                <TH>Kamera</TH>
                                <TH>Status</TH>
                                <TH>Selisih</TH>
                                <TH>Cara menjaga waktu</TH>
                                <TH>Diperiksa</TH>
                                <TH align="right"><span className="sr-only">Aksi</span></TH>
                            </TR>
                        </THead>
                        <TBody>
                            {cameras.map((kamera) => (
                                <TR key={kamera.id}>
                                    <TD>
                                        <span className="text-content">{kamera.name}</span>
                                        {kamera.hasOnvifCredentials && (
                                            <span className="ml-2 rounded bg-surface-raised px-1.5 py-0.5 text-[11px] text-content-muted">
                                                akun ONVIF khusus
                                            </span>
                                        )}
                                    </TD>
                                    <TD><LencanaStatus kamera={kamera} /></TD>
                                    <TD>{kamera.stale ? '—' : ucapkanSelisih(kamera.driftSeconds)}</TD>
                                    <TD>{PENJELASAN_METODE[kamera.method] || kamera.note || '—'}</TD>
                                    <TD>{ucapkanUmur(kamera.ageMinutes)}</TD>
                                    <TD align="right">
                                        <Button variant="ghost" size="sm" onClick={() => bukaEditor(kamera)}>
                                            Akun ONVIF
                                        </Button>
                                    </TD>
                                </TR>
                            ))}
                            {cameras.length === 0 && (
                                <TR>
                                    <TD className="py-6 text-center text-content-muted" colSpan={6}>
                                        Belum ada kamera internal yang bisa diselaraskan.
                                    </TD>
                                </TR>
                            )}
                        </TBody>
                    </Table>
                </TableShell>
            )}

            {bermasalah.length > 0 && !loading && !gagalMuat && (
                <p className="text-xs text-content-muted">
                    Kamera yang tak terjangkau belum tentu jamnya salah — sebagian model memang
                    tidak menyediakan jalur jaringan untuk diperiksa.
                </p>
            )}

            {editing && (
                <Modal
                    title={`Akun ONVIF: ${editing.name}`}
                    description="Hanya untuk keadaan darurat. Kosongkan untuk memakai akun RTSP kamera."
                    onClose={() => setEditing(null)}
                    footer={(
                        <ModalFooter>
                            <Button variant="ghost" onClick={() => setEditing(null)}>Batal</Button>
                            <Button type="submit" form={KREDENSIAL_FORM_ID} loading={saving}>
                                Simpan
                            </Button>
                        </ModalFooter>
                    )}
                >
                    <form id={KREDENSIAL_FORM_ID} onSubmit={simpanKredensial} className="space-y-4">
                        <p className="text-sm text-content-muted">
                            Penyelaras memakai akun dari URL RTSP kamera, dan itu benar untuk hampir
                            semua perangkat — jadi biasanya kolom ini tidak perlu diisi sama sekali.
                            Isi hanya bila firmware kamera memisahkan akun ONVIF dari akun utama,
                            atau bila akun RTSP-nya sengaja dibuat tanpa izin mengubah setelan.
                        </p>
                        <div>
                            <label htmlFor="onvif-username" className="mb-1 block text-sm text-content">
                                Nama pengguna ONVIF
                            </label>
                            <input
                                id="onvif-username"
                                type="text"
                                autoComplete="off"
                                value={form.username}
                                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                                className="w-full rounded-control border border-edge bg-surface px-3 py-2 text-base text-content sm:text-sm"
                                placeholder="kosongkan untuk memakai akun RTSP"
                            />
                        </div>
                        <div>
                            <label htmlFor="onvif-password" className="mb-1 block text-sm text-content">
                                Sandi ONVIF
                            </label>
                            <input
                                id="onvif-password"
                                type="password"
                                autoComplete="new-password"
                                value={form.password}
                                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                                className="w-full rounded-control border border-edge bg-surface px-3 py-2 text-base text-content sm:text-sm"
                                placeholder="kosongkan untuk memakai akun RTSP"
                            />
                        </div>
                        {/*
                          * Sandi tersimpan tidak pernah dikirim balik ke panel, jadi kolomnya selalu
                          * mulai kosong. Menyimpan dalam keadaan kosong BENAR-BENAR mengosongkannya —
                          * itu harus dikatakan, kalau tidak operator yang hanya ingin mengubah nama
                          * pengguna akan menghapus sandinya tanpa sadar.
                          */}
                        <p className="text-xs text-content-muted">
                            Menyimpan dengan kedua kolom kosong akan menghapus akun khusus ini dan
                            kembali memakai akun RTSP.
                        </p>
                    </form>
                </Modal>
            )}
        </div>
    );
}

export default CameraTimeStatus;
