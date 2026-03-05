import { useState, useEffect, useCallback } from 'react';
import { brandingService } from '../../../services/brandingService';
import { useBranding } from '../../../contexts/BrandingContext';
import { useNotification } from '../../../contexts/NotificationContext';

export default function BrandingSettingsPanel() {
    const { refreshBranding } = useBranding();
    const { success, error: showError } = useNotification();
    const [settings, setSettings] = useState([]);
    const [formData, setFormData] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadSettings = useCallback(async () => {
        try {
            setLoading(true);
            const response = await brandingService.getAdminBranding();
            if (!response.success) {
                showError('Gagal Memuat', response.message || 'Failed to load branding settings');
                return;
            }

            setSettings(response.data);
            const nextFormData = {};
            response.data.forEach((setting) => {
                nextFormData[setting.key] = setting.value || '';
            });
            setFormData(nextFormData);
        } catch (requestError) {
            showError('Gagal Memuat', 'Failed to load branding settings');
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
                showError('Gagal Menyimpan', response.message || 'Failed to update branding settings');
                return;
            }

            success('Branding Tersimpan', 'Branding settings updated successfully.');
            await refreshBranding();
            await loadSettings();
        } catch (requestError) {
            showError('Gagal Menyimpan', 'Failed to update branding settings');
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        if (!window.confirm('Reset semua branding ke default?')) {
            return;
        }

        try {
            setSaving(true);
            const response = await brandingService.resetToDefaults();
            if (!response.success) {
                showError('Gagal Reset', response.message || 'Failed to reset branding settings');
                return;
            }

            success('Branding Direset', 'Branding reset to defaults.');
            await refreshBranding();
            await loadSettings();
        } catch (requestError) {
            showError('Gagal Reset', 'Failed to reset branding settings');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500"></div>
            </div>
        );
    }

    const groupedSettings = {
        'Company Information': ['company_name', 'company_tagline', 'company_description', 'city_name', 'province_name', 'whatsapp_number'],
        'Hero Section': ['hero_title', 'hero_subtitle'],
        Footer: ['footer_text', 'copyright_text'],
        'SEO Meta Tags': ['meta_title', 'meta_description', 'meta_keywords'],
        Visual: ['logo_text', 'primary_color', 'show_powered_by'],
        Watermark: ['watermark_enabled', 'watermark_text', 'watermark_position', 'watermark_opacity'],
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Branding Settings</h2>
                    <p className="text-gray-600 dark:text-gray-400 mt-1">Customize your CCTV system branding and appearance.</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleReset}
                        disabled={saving}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                        Reset to Defaults
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>

            <div className="space-y-6">
                {Object.entries(groupedSettings).map(([groupName, keys]) => (
                    <div key={groupName} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{groupName}</h3>
                        <div className="space-y-4">
                            {keys.map((key) => {
                                const setting = settings.find((item) => item.key === key);
                                if (!setting) {
                                    return null;
                                }

                                const isTextarea = ['company_description', 'hero_subtitle', 'footer_text', 'meta_description', 'meta_keywords'].includes(key);
                                const isColor = key === 'primary_color';
                                const isBoolean = ['show_powered_by', 'watermark_enabled'].includes(key);
                                const isSelect = key === 'watermark_position';
                                const isNumber = key === 'watermark_opacity';

                                return (
                                    <div key={key}>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{setting.description || key}</label>
                                        {isTextarea ? (
                                            <textarea
                                                value={formData[key] || ''}
                                                onChange={(event) => handleChange(key, event.target.value)}
                                                rows={3}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            />
                                        ) : isColor ? (
                                            <div className="flex gap-3 items-center">
                                                <input
                                                    type="color"
                                                    value={formData[key] || '#0ea5e9'}
                                                    onChange={(event) => handleChange(key, event.target.value)}
                                                    className="h-10 w-20 rounded border border-gray-300 dark:border-gray-600"
                                                />
                                                <input
                                                    type="text"
                                                    value={formData[key] || ''}
                                                    onChange={(event) => handleChange(key, event.target.value)}
                                                    placeholder="#0ea5e9"
                                                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                />
                                            </div>
                                        ) : isBoolean ? (
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={formData[key] === 'true'}
                                                    onChange={(event) => handleChange(key, event.target.checked ? 'true' : 'false')}
                                                    className="rounded border-gray-300 dark:border-gray-600"
                                                />
                                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                                    {key === 'show_powered_by' ? `Show "Powered by ${formData.company_name || 'Company'}" badge` : 'Enable watermark on snapshots'}
                                                </span>
                                            </label>
                                        ) : isSelect ? (
                                            <select
                                                value={formData[key] || 'bottom-right'}
                                                onChange={(event) => handleChange(key, event.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            >
                                                <option value="bottom-right">Bottom Right</option>
                                                <option value="bottom-left">Bottom Left</option>
                                                <option value="top-right">Top Right</option>
                                                <option value="top-left">Top Left</option>
                                            </select>
                                        ) : (
                                            <input
                                                type={isNumber ? 'number' : 'text'}
                                                value={formData[key] || ''}
                                                onChange={(event) => handleChange(key, event.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
