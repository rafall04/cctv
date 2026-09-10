import { useState, useEffect, useCallback } from 'react';
import { brandingService } from '../../../services/brandingService';
import { useBranding } from '../../../contexts/BrandingContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';

export default function BrandingSettingsPanel() {
    const { refreshBranding } = useBranding();
    const { success, error: showError } = useNotification();
    const confirm = useConfirm();
    const [settings, setSettings] = useState([]);
    const [formData, setFormData] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadSettings = useCallback(async () => {
        try {
            setLoading(true);
            const response = await brandingService.getAdminBranding();
            if (!response.success) {
                showError('Gagal Memuat', response.message || 'Gagal memuat pengaturan branding');
                return;
            }

            setSettings(response.data);
            const nextFormData = {};
            response.data.forEach((setting) => {
                nextFormData[setting.key] = setting.value || '';
            });
            setFormData(nextFormData);
        } catch (requestError) {
            showError('Gagal Memuat', 'Gagal memuat pengaturan branding');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const handleChange = (key, value) => {
        setFormData((prev) => ({
            ...prev,
            [key]: value,
        }));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            const response = await brandingService.bulkUpdate(formData);
            if (!response.success) {
                showError('Gagal Menyimpan', response.message || 'Gagal memperbarui pengaturan branding');
                return;
            }

            success('Branding Tersimpan', 'Pengaturan branding berhasil diperbarui.');
            await refreshBranding();
            await loadSettings();
        } catch (requestError) {
            showError('Gagal Menyimpan', 'Gagal memperbarui pengaturan branding');
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        if (!(await confirm({ title: 'Reset semua branding ke default?', confirmLabel: 'Reset', tone: 'danger' }))) {
            return;
        }

        try {
            setSaving(true);
            const response = await brandingService.resetToDefaults();
            if (!response.success) {
                showError('Gagal Reset', response.message || 'Gagal mereset pengaturan branding');
                return;
            }

            success('Branding Direset', 'Branding dikembalikan ke default.');
            await refreshBranding();
            await loadSettings();
        } catch (requestError) {
            showError('Gagal Reset', 'Gagal mereset pengaturan branding');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    const groupedSettings = {
        'Informasi Perusahaan': ['company_name', 'company_tagline', 'company_description', 'city_name', 'province_name', 'whatsapp_number', 'whatsapp_message_template'],
        'Bagian Hero': ['hero_title', 'hero_subtitle'],
        Footer: ['footer_text', 'copyright_text'],
        'Meta Tag SEO': ['meta_title', 'meta_description', 'meta_keywords'],
        Visual: ['logo_text', 'primary_color', 'show_powered_by'],
        Watermark: ['watermark_enabled', 'watermark_text', 'watermark_position', 'watermark_opacity'],
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-content">Pengaturan Branding</h2>
                    <p className="text-content-muted mt-1">Sesuaikan branding dan tampilan sistem CCTV Anda.</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleReset}
                        disabled={saving}
                        className="px-4 py-2 border border-edge-strong rounded-control hover:bg-surface-raised disabled:opacity-50"
                    >
                        Reset ke Default
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 bg-primary text-white rounded-control hover:bg-primary-600 disabled:opacity-50"
                    >
                        {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
                    </button>
                </div>
            </div>

            <div className="space-y-6">
                {Object.entries(groupedSettings).map(([groupName, keys]) => (
                    <div key={groupName} className="bg-surface rounded-card shadow-e1 p-6">
                        <h3 className="text-lg font-semibold text-content mb-4">{groupName}</h3>
                        <div className="space-y-4">
                            {keys.map((key) => {
                                const setting = settings.find((item) => item.key === key);
                                if (!setting) {
                                    return null;
                                }

                                const isTextarea = ['company_description', 'hero_subtitle', 'footer_text', 'meta_description', 'meta_keywords', 'whatsapp_message_template'].includes(key);
                                const isColor = key === 'primary_color';
                                const isBoolean = ['show_powered_by', 'watermark_enabled'].includes(key);
                                const isSelect = key === 'watermark_position';
                                const isNumber = key === 'watermark_opacity';
                                // F6: template field gets a placeholder hint
                                // listing every supported substitution so admins
                                // discover them without reading docs.
                                const placeholderHint = key === 'whatsapp_message_template'
                                    ? 'Placeholder yang didukung: {{company_name}}, {{city_name}}, {{page}}, {{camera_name}}'
                                    : null;

                                return (
                                    <div key={key}>
                                        <label htmlFor={`branding-${key}`} className="block text-sm font-medium text-content-muted mb-1">{setting.description || key}</label>
                                        {placeholderHint && (
                                            <p className="text-xs text-content-muted mb-2">{placeholderHint}</p>
                                        )}
                                        {isTextarea ? (
                                            <textarea
                                                id={`branding-${key}`}
                                                value={formData[key] || ''}
                                                onChange={(event) => handleChange(key, event.target.value)}
                                                rows={3}
                                                className="w-full px-3 py-2 border border-edge-strong rounded-control bg-surface text-content"
                                            />
                                        ) : isColor ? (
                                            <div className="flex gap-3 items-center">
                                                <input
                                                    id={`branding-${key}`}
                                                    type="color"
                                                    value={formData[key] || '#0ea5e9'}
                                                    onChange={(event) => handleChange(key, event.target.value)}
                                                    className="h-10 w-20 rounded border border-edge-strong"
                                                />
                                                <input
                                                    type="text"
                                                    value={formData[key] || ''}
                                                    onChange={(event) => handleChange(key, event.target.value)}
                                                    placeholder="#0ea5e9"
                                                    className="flex-1 px-3 py-2 border border-edge-strong rounded-control bg-surface text-content"
                                                />
                                            </div>
                                        ) : isBoolean ? (
                                            <label className="flex items-center gap-2">
                                                <input
                                                    id={`branding-${key}`}
                                                    type="checkbox"
                                                    checked={formData[key] === 'true'}
                                                    onChange={(event) => handleChange(key, event.target.checked ? 'true' : 'false')}
                                                    className="rounded border-edge-strong"
                                                />
                                                <span className="text-sm text-content-muted">
                                                    {key === 'show_powered_by' ? `Tampilkan badge "Powered by ${formData.company_name || 'Company'}"` : 'Aktifkan watermark pada snapshot'}
                                                </span>
                                            </label>
                                        ) : isSelect ? (
                                            <select
                                                id={`branding-${key}`}
                                                value={formData[key] || 'bottom-right'}
                                                onChange={(event) => handleChange(key, event.target.value)}
                                                className="w-full px-3 py-2 border border-edge-strong rounded-control bg-surface text-content"
                                            >
                                                <option value="bottom-right">Kanan Bawah</option>
                                                <option value="bottom-left">Kiri Bawah</option>
                                                <option value="top-right">Kanan Atas</option>
                                                <option value="top-left">Kiri Atas</option>
                                            </select>
                                        ) : (
                                            <input
                                                id={`branding-${key}`}
                                                type={isNumber ? 'number' : 'text'}
                                                value={formData[key] || ''}
                                                onChange={(event) => handleChange(key, event.target.value)}
                                                className="w-full px-3 py-2 border border-edge-strong rounded-control bg-surface text-content"
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
