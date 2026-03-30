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
            await Promise.all(HEALTH_SETTING_FIELDS.map((field) => (
                settingsService.updateSetting(
                    field.key,
                    form[field.key],
                    `Stream health default for ${field.label.toLowerCase()}`
                )
            )));
            success('Default Tersimpan', 'Default stream health berhasil diperbarui.');
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Stream Health Defaults</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Urutan precedence: camera override, area override, global default, lalu fallback sistem.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                    {HEALTH_SETTING_FIELDS.map((field) => (
                        <div
                            key={field.key}
                            className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/40"
                        >
                            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                                {field.label}
                            </label>
                            <select
                                value={form[field.key]}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    [field.key]: event.target.value,
                                }))}
                                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            >
                                {HEALTH_MODE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{field.description}</p>
                        </div>
                    ))}
                </div>

                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200">
                    Gunakan area override untuk kebijakan steady-state per lokasi, lalu pakai camera override hanya untuk kamera khusus yang memang perlu perlakuan berbeda.
                </div>

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {saving ? 'Menyimpan...' : 'Simpan Default'}
                    </button>
                </div>
            </form>
        </div>
    );
}
