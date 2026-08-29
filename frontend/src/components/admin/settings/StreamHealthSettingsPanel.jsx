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

const DEFAULT_FORM = {
    ...Object.fromEntries(HEALTH_SETTING_FIELDS.map((field) => [field.key, 'passive_first'])),
    // Dead-at-source detection — separate concern from the probe-mode defaults above.
    camera_source_dead_confirm_hours: 6,
};

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
                    // Number(...) || 6: a stored 0/blank is not a valid confirm window, so fall to the default.
                    camera_source_dead_confirm_hours: Number(result.data.camera_source_dead_confirm_hours) || 6,
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
            // A confirm window of 0/blank/NaN would read as "call everything dead immediately" —
            // refuse it here rather than silently persist a value that turns the panel into noise.
            const hours = Number(form.camera_source_dead_confirm_hours);
            if (!Number.isFinite(hours) || hours <= 0) {
                showError('Nilai tidak valid', 'Jam konfirmasi "sumber mati" harus angka lebih dari 0.');
                return;
            }
            const results = await Promise.all([
                ...HEALTH_SETTING_FIELDS.map((field) => (
                    settingsService.updateSetting(
                        field.key,
                        form[field.key],
                        `Stream health default for ${field.label.toLowerCase()}`
                    )
                )),
                settingsService.updateSetting(
                    'camera_source_dead_confirm_hours',
                    hours,
                    'Jam sebuah gejala harus bertahan sebelum kamera ditandai mati di sumber'
                ),
            ]);
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

                <div className="rounded-2xl border border-edge bg-surface-sunken p-4 space-y-4">
                    <div>
                        <h4 className="text-sm font-semibold text-content">Deteksi Sumber Mati</h4>
                        <p className="mt-1 text-xs text-content-muted">
                            Kapan sebuah kamera dianggap benar-benar hilang di sisi penyedia (bukan sekadar
                            offline sesaat).
                        </p>
                    </div>
                    <label className="block max-w-xs">
                        <span className="mb-1 block text-sm font-medium text-content">Konfirmasi &ldquo;sumber mati&rdquo; setelah</span>
                        <span className="flex items-center gap-2">
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={form.camera_source_dead_confirm_hours}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    camera_source_dead_confirm_hours: event.target.value,
                                }))}
                                className="w-full rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                            />
                            <span className="shrink-0 text-xs text-content-muted">jam</span>
                        </span>
                        <p className="mt-2 text-xs text-content-muted">
                            Gejala (playlist ditutup / 404) harus bertahan selama ini sebelum kamera ditandai
                            mati di sumber. Feed yang restart tiap malam butuh jendela lebih panjang. Default 6 jam.
                        </p>
                    </label>
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
