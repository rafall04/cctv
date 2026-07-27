import { useCallback, useEffect, useState } from 'react';
import { settingsService } from '../../../services/settingsService';
import { useNotification } from '../../../contexts/NotificationContext';

const HEALTH_SETTING_FIELDS = [
    {
        key: 'external_mjpeg_health_default',
        label: 'Default MJPEG',
        description: 'Cocok untuk sumber MJPEG seperti Jombang yang sering false offline.',
    },
    {
        key: 'external_hls_health_default',
        label: 'Default HLS',
        description: 'Dipakai untuk external HLS yang masih butuh hybrid probe.',
    },
    {
        key: 'external_flv_health_default',
        label: 'Default FLV',
        description: 'Cocok untuk HTTP-FLV live seperti Surakarta yang lebih aman dipantau via runtime.',
    },
    {
        key: 'external_embed_health_default',
        label: 'Default Embed',
        description: 'Biasanya cukup passive-first karena backend tidak punya playability penuh.',
    },
    {
        key: 'external_jsmpeg_health_default',
        label: 'Default JSMPEG',
        description: 'Passive-only atau disabled untuk transport custom yang tidak stabil diprobe.',
    },
    {
        key: 'external_custom_ws_health_default',
        label: 'Default Custom WS',
        description: 'Untuk helper WebSocket/custom transport yang tidak cocok dengan HTTP probe.',
    },
];

const HEALTH_MODE_OPTIONS = [
    { value: 'passive_first', label: 'Passive First' },
    { value: 'hybrid_probe', label: 'Hybrid Probe' },
    { value: 'probe_first', label: 'Probe First' },
    { value: 'disabled', label: 'Disabled' },
];

const DEFAULT_FORM = Object.fromEntries(HEALTH_SETTING_FIELDS.map((field) => [field.key, 'passive_first']));

export default function StreamHealthSettingsPanel() {
    const { success, error: showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(DEFAULT_FORM);

    const loadSettings = useCallback(async () => {
        try {
            setLoading(true);
            const result = await settingsService.getAllSettings();
            if (result.success) {
                setForm({
                    external_mjpeg_health_default: result.data.external_mjpeg_health_default || 'passive_first',
                    external_hls_health_default: result.data.external_hls_health_default || 'hybrid_probe',
                    external_flv_health_default: result.data.external_flv_health_default || 'passive_first',
                    external_embed_health_default: result.data.external_embed_health_default || 'passive_first',
                    external_jsmpeg_health_default: result.data.external_jsmpeg_health_default || 'disabled',
                    external_custom_ws_health_default: result.data.external_custom_ws_health_default || 'disabled',
                });
            }
        } catch (error) {
            console.error('Load stream health defaults error:', error);
            showError('Gagal Memuat', 'Tidak bisa memuat default health monitoring.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            setSaving(true);
            const results = await Promise.all(HEALTH_SETTING_FIELDS.map((field) => (
                settingsService.updateSetting(
                    field.key,
                    form[field.key],
                    `Stream health default for ${field.label.toLowerCase()}`
                )
            )));
            const failed = results.find((result) => !result.success);
            if (failed) {
                showError('Gagal Menyimpan', failed.message || 'Tidak bisa menyimpan default health monitoring.');
            } else {
                success('Default Tersimpan', 'Default stream health berhasil diperbarui.');
            }
        } catch (error) {
            console.error('Save stream health defaults error:', error);
            showError('Gagal Menyimpan', 'Tidak bisa menyimpan default health monitoring.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="bg-surface rounded-xl shadow-sm border border-edge">
            <div className="p-6 border-b border-edge">
                <h3 className="text-lg font-semibold text-content">Stream Health Defaults</h3>
                <p className="text-sm text-content-muted mt-1">
                    Urutan precedence: camera override, area override, global default, lalu fallback sistem.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                    {HEALTH_SETTING_FIELDS.map((field) => (
                        <div
                            key={field.key}
                            className="rounded-2xl border border-edge bg-surface-sunken p-4"
                        >
                            <label className="block text-sm font-semibold text-content mb-2">
                                {field.label}
                            </label>
                            <select
                                value={form[field.key]}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    [field.key]: event.target.value,
                                }))}
                                className="w-full rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                            >
                                {HEALTH_MODE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <p className="mt-2 text-xs text-content-muted">{field.description}</p>
                        </div>
                    ))}
                </div>

                <div className="rounded-2xl border border-primary-300 bg-primary-100 px-4 py-3 text-sm text-primary border-primary-300 dark:bg-primary/10 text-primary">
                    Gunakan area override untuk kebijakan steady-state per lokasi, lalu pakai camera override hanya untuk kamera khusus yang memang perlu perlakuan berbeda.
                </div>

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {saving ? 'Menyimpan...' : 'Simpan Default'}
                    </button>
                </div>
            </form>
        </div>
    );
}
