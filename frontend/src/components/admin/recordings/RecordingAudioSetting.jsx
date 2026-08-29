/*
 * Purpose: Toggle whether recordings capture the camera's audio track — settable by ADMIN from the
 *          web, replacing the RECORDING_AUDIO env var.
 * Caller: RecordingDashboard, beside the storage-limit card.
 * Deps: apiClient (GET/PUT /api/settings/recording_audio_enabled), NotificationContext, ui.
 *
 * KENAPA DI SINI, BUKAN DI .env
 * -----------------------------
 * Menyalakan/mematikan audio rekaman dulu hanya lewat RECORDING_AUDIO di .env lalu restart — bukan
 * pekerjaan operator, apalagi calon klien pembeli source code. Nilai ini kini di tabel settings dan
 * dibaca SEGAR tiap kali perekam mulai, jadi perubahan di sini berlaku pada segmen berikutnya tiap
 * kamera tanpa restart. Fallback per-kamera (kamera yang mengaku beraudio tapi diam otomatis turun
 * ke video-saja) tidak terpengaruh — ini sakelar GLOBAL, bukan penentu per-kamera.
 */

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '../../ui';
import apiClient from '../../../services/apiClient';
import { useNotification } from '../../../contexts/NotificationContext';

const KEY = 'recording_audio_enabled';

export default function RecordingAudioSetting() {
    const { success: notifySuccess, error: notifyError } = useNotification();
    const [loaded, setLoaded] = useState(false);
    const [enabled, setEnabled] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let hidup = true;
        apiClient.get(`/api/settings/${KEY}`)
            .then((res) => {
                if (!hidup) return;
                const v = res.data?.data?.value;
                if (v !== undefined && v !== null) {
                    setEnabled(v === true || v === 'true' || v === 1 || v === '1' || v === 'on');
                }
            })
            .catch(() => {})   // 404 (belum pernah diset) = biarkan default: aktif.
            .finally(() => { if (hidup) setLoaded(true); });
        return () => { hidup = false; };
    }, []);

    const simpan = async () => {
        setSaving(true);
        try {
            await apiClient.put(`/api/settings/${KEY}`, {
                value: enabled,
                description: 'Rekam jalur audio kamera (adaptif per-perangkat); nonaktif = rekaman video saja',
            });
            notifySuccess('Setelan tersimpan', 'Berlaku pada segmen berikutnya tiap kamera, tanpa perlu restart.');
        } catch (err) {
            notifyError('Gagal menyimpan', err?.response?.data?.message || err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader
                title={<span className="text-sm font-semibold text-content">Rekam audio</span>}
                description="Saat aktif, rekaman menyertakan audio dari kamera yang punya mikrofon. Kamera tanpa audio tetap terekam video saja secara otomatis."
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
                        <span className="block text-sm font-medium text-content">Rekam audio bila kamera mendukung</span>
                        <span className="block text-xs text-content-muted">
                            Nonaktifkan untuk kembali ke rekaman video-saja di seluruh kamera (mis. saat audio bermasalah).
                        </span>
                    </span>
                </label>

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
