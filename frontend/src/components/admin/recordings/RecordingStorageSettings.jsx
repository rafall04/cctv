/*
 * Purpose: Setelan penyimpanan rekaman yang bisa diubah ADMIN dari halaman web, bukan lewat .env.
 * Caller: RecordingDashboard, di bawah panel kapasitas.
 * Deps: apiClient (GET/PUT /api/settings/:key), components/ui.
 *
 * KENAPA KOMPONEN INI ADA
 * -----------------------
 * Batas penyimpanan penahanan-arsip dulu HANYA bisa diatur lewat env (RECORDING_MAX_STORAGE_GB),
 * yang tidak ramah untuk calon klien pembeli source code: menyunting .env lalu me-restart bukan
 * pekerjaan operator. Nilai ini kini disimpan di tabel settings dan dibaca SEGAR tiap siklus
 * cleanup, jadi perubahan di sini berlaku tanpa restart.
 *
 * Dua setelan saja - yang benar-benar urusan sehari-hari:
 *   · aktif/tidak penahanan (recording_archive_hold_enabled);
 *   · maksimal ruang rekaman dalam GB (recording_max_storage_gb; kosong/0 = tanpa batas).
 * Knob lanjutan (lantai keamanan disk, jendela kamera-aktif) sengaja TIDAK di sini - keduanya
 * invarian/teknis, tetap di env dengan bawaan aman.
 */

import { useEffect, useState } from 'react';
import { Card, CardHeader, Field } from '../../ui';
import apiClient from '../../../services/apiClient';
import { useNotification } from '../../../contexts/NotificationContext';

const MAX_KEY = 'recording_max_storage_gb';
const ENABLED_KEY = 'recording_archive_hold_enabled';

/** GET satu setting; 404 (belum diset) dikembalikan sebagai null, bukan galat. */
async function bacaSetting(key) {
    try {
        const res = await apiClient.get(`/api/settings/${key}`);
        return res.data?.data?.value ?? null;
    } catch {
        return null;
    }
}

export default function RecordingStorageSettings() {
    const { success: notifySuccess, error: notifyError } = useNotification();
    const [loaded, setLoaded] = useState(false);
    const [enabled, setEnabled] = useState(true);
    const [maxGb, setMaxGb] = useState('');   // string di input; '' = tanpa batas
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let hidup = true;
        Promise.all([bacaSetting(ENABLED_KEY), bacaSetting(MAX_KEY)]).then(([en, max]) => {
            if (!hidup) return;
            if (en !== null) setEnabled(en === true || en === 'true' || en === 1 || en === '1');
            if (max !== null && Number(max) > 0) setMaxGb(String(max));
            setLoaded(true);
        });
        return () => { hidup = false; };
    }, []);

    const simpan = async () => {
        // Angka divalidasi di sini supaya kesalahan ketik tidak diam-diam jadi 'tanpa batas'.
        const trimmed = String(maxGb).trim();
        let nilaiMax = 0;
        if (trimmed !== '') {
            const n = Number(trimmed);
            if (!Number.isFinite(n) || n < 0) {
                notifyError('Nilai tidak valid', 'Maksimal penyimpanan harus angka (GB), atau kosongkan untuk tanpa batas.');
                return;
            }
            nilaiMax = Math.floor(n);
        }
        setSaving(true);
        try {
            await apiClient.put(`/api/settings/${ENABLED_KEY}`, {
                value: enabled,
                description: 'Aktifkan penahanan rekaman yang belum terunggah ke Telegram saat jaringan bermasalah',
            });
            await apiClient.put(`/api/settings/${MAX_KEY}`, {
                value: nilaiMax,
                description: 'Maksimal ruang (GB) yang boleh dipakai rekaman untuk penahanan arsip; 0 = tanpa batas',
            });
            notifySuccess('Setelan tersimpan', 'Berlaku pada siklus pembersihan berikutnya, tanpa perlu restart.');
        } catch (err) {
            notifyError('Gagal menyimpan', err?.response?.data?.message || err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader
                title={<span className="text-sm font-semibold text-content">Batas penyimpanan rekaman</span>}
                description="Saat jaringan ke Telegram bermasalah, rekaman yang belum sempat terunggah DITAHAN (tidak dihapus retensi) selama masih ada ruang. Atur batasnya di sini."
            />

            <div className="mt-4 space-y-4">
                <label className="flex items-start gap-3">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                        disabled={!loaded}
                    />
                    <span className="min-w-0">
                        <span className="block text-sm font-medium text-content">Tahan rekaman yang belum terunggah</span>
                        <span className="block text-xs text-content-muted">
                            Mencegah rekaman hilang saat outage. Matikan hanya kalau ingin perilaku lama (hapus di retensi).
                        </span>
                    </span>
                </label>

                <div className="max-w-xs">
                    <Field
                        label="Maksimal penyimpanan rekaman (GB)"
                        type="number"
                        min="0"
                        step="1"
                        value={maxGb}
                        onChange={(e) => setMaxGb(e.target.value)}
                        placeholder="Kosong = tanpa batas (ikut ukuran disk)"
                        disabled={!loaded || !enabled}
                    />
                    <p className="mt-1 text-xs text-content-muted">
                        Setelah total rekaman mencapai angka ini, yang paling lama dilepas lebih dulu. Kosongkan
                        untuk memakai seluruh disk (rekaman live selalu diberi sisa aman otomatis).
                    </p>
                </div>

                <button
                    type="button"
                    onClick={simpan}
                    disabled={saving || !loaded}
                    className="rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
                >
                    {saving ? 'Menyimpan…' : 'Simpan setelan'}
                </button>
            </div>
        </Card>
    );
}
