/*
 * Purpose: Toggle whether the recording pipeline sends health alerts to Telegram — settable by
 *          ADMIN from the web, replacing the RECORDING_HEALTH_ALERTS_ENABLED env var.
 * Caller: RecordingDashboard, beside RecordingHealthPanel (the very health these alerts are about).
 * Deps: apiClient (GET/PUT /api/settings/recording_health_alerts_enabled), NotificationContext, ui.
 *
 * KENAPA DI SINI, BUKAN DI .env / DI TAB TELEGRAM
 * -----------------------------------------------
 * Nyala/mati alert dulu hanya lewat env lalu restart. Nilai ini kini di tabel settings dan dibaca
 * SEGAR tiap siklus scheduler, jadi perubahan berlaku tanpa restart. Diletakkan di dasbor Rekaman —
 * tepat di sebelah panel kesehatan yang jadi sumber alertnya — karena itulah tempat operator
 * melihat kondisi yang memicu alert. GRUP TUJUAN alert tetap diatur di tab Bot Telegram; ini hanya
 * sakelar nyala/matinya.
 */

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '../../ui';
import apiClient from '../../../services/apiClient';
import { useNotification } from '../../../contexts/NotificationContext';

const KEY = 'recording_health_alerts_enabled';

export default function RecordingHealthAlertSetting() {
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
                description: 'Kirim alert Telegram saat kesehatan pipeline rekaman berubah (ok/warning/kritis)',
            });
            notifySuccess('Setelan tersimpan', 'Berlaku pada siklus pemantauan berikutnya, tanpa perlu restart.');
        } catch (err) {
            notifyError('Gagal menyimpan', err?.response?.data?.message || err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader
                title={<span className="text-sm font-semibold text-content">Alert kesehatan rekaman</span>}
                description="Kirim pesan Telegram otomatis saat kesehatan pipeline rekaman berpindah level (sehat ⇄ perlu perhatian ⇄ kritis). Grup tujuannya diatur di tab Bot Telegram."
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
                        <span className="block text-sm font-medium text-content">Kirim alert saat kesehatan berubah</span>
                        <span className="block text-xs text-content-muted">
                            Matikan untuk membungkam seluruh alert pipeline rekaman tanpa menyentuh notifikasi kamera.
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
