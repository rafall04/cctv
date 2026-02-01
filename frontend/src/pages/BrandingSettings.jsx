import { useState, useEffect } from 'react';
import { brandingService } from '../services/brandingService';
import { useBranding } from '../contexts/BrandingContext';
import { useNotification } from '../contexts/NotificationContext';

export default function BrandingSettings() {
    const { refreshBranding } = useBranding();
    const { showNotification } = useNotification();
    const [settings, setSettings] = useState([]);
    const [formData, setFormData] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            setLoading(true);
            const response = await brandingService.getAdminBranding();
            if (response.success) {
                setSettings(response.data);
                
                // Convert to form data
                const data = {};
                response.data.forEach(setting => {
                    data[setting.key] = setting.value || '';
                });
                setFormData(data);
            }
        } catch (error) {
            showNotification('Failed to load branding settings', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (key, value) => {
        setFormData(prev => ({
            ...prev,
            [key]: value
        }));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            const response = await brandingService.bulkUpdate(formData);
            
            if (response.success) {
                showNotification('Branding settings updated successfully', 'success');
                await refreshBranding(); // Refresh branding context
                await loadSettings(); // Reload to get updated metadata
            }
        } catch (error) {
            showNotification('Failed to update branding settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        if (!confirm('Reset all branding to default values? This cannot be undone.')) {
            return;
        }

        try {
            setSaving(true);
            const response = await brandingService.resetToDefaults();
            
            if (response.success) {
                showNotification('Branding reset to defaults', 'success');
                await refreshBranding();
                await loadSettings();
            }
        } catch (error) {
            showNotification('Failed to reset branding', 'error');
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
        'Footer': ['footer_text', 'copyright_text'],
        'SEO Meta Tags': ['meta_title', 'meta_description', 'meta_keywords'],
        'Visual': ['logo_text', 'primary_color', 'show_powered_by'],
        'Watermark': ['watermark_enabled', 'watermark_text', 'watermark_position', 'watermark_opacity'],
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Branding Settings
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-1">
                        Customize your CCTV system branding and appearance
                    </p>
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

            {/* Settings Groups */}
            <div className="space-y-6">
                {Object.entries(groupedSettings).map(([groupName, keys]) => (
                    <div key={groupName} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                            {groupName}
                        </h2>
                        <div className="space-y-4">
                            {keys.map(key => {
                                const setting = settings.find(s => s.key === key);
                                if (!setting) return null;

                                const isTextarea = ['company_description', 'hero_subtitle', 'footer_text', 'meta_description', 'meta_keywords'].includes(key);
                                const isColor = key === 'primary_color';
                                const isBoolean = ['show_powered_by', 'watermark_enabled'].includes(key);
                                const isSelect = key === 'watermark_position';
                                const isNumber = key === 'watermark_opacity';

                                return (
                                    <div key={key}>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            {setting.description || key}
                                        </label>
                                        {isTextarea ? (
                                            <textarea
                                                value={formData[key] || ''}
                                                onChange={(e) => handleChange(key, e.target.value)}
                                                rows={3}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            />
                                        ) : isColor ? (
                                            <div className="flex gap-3 items-center">
                                                <input
                                                    type="color"
                                                    value={formData[key] || '#0ea5e9'}
                                                    onChange={(e) => handleChange(key, e.target.value)}
                                                    className="h-10 w-20 rounded border border-gray-300 dark:border-gray-600"
                                                />
                                                <input
                                                    type="text"
                                                    value={formData[key] || ''}
                                                    onChange={(e) => handleChange(key, e.target.value)}
                                                    placeholder="#0ea5e9"
                                                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                />
                                            </div>
                                        ) : isBoolean ? (
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={formData[key] === 'true'}
                                                    onChange={(e) => handleChange(key, e.target.checked ? 'true' : 'false')}
                                                    className="rounded border-gray-300 dark:border-gray-600"
                                                />
                                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                                    {key === 'show_powered_by' 
                                                        ? `Show "Powered by ${formData.company_name || 'Company'}" badge`
                                                        : 'Enable watermark on snapshots'}
                                                </span>
                                            </label>
                                        ) : isSelect ? (
                                            <select
                                                value={formData[key] || 'bottom-right'}
                                                onChange={(e) => handleChange(key, e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            >
                                                <option value="bottom-right">Bottom Right</option>
                                                <option value="bottom-left">Bottom Left</option>
                                                <option value="top-right">Top Right</option>
                                                <option value="top-left">Top Left</option>
                                            </select>
                                        ) : isNumber ? (
                                            <div className="flex gap-3 items-center">
                                                <input
                                                    type="range"
                                                    min="0.1"
                                                    max="1"
                                                    step="0.1"
                                                    value={formData[key] || '0.9'}
                                                    onChange={(e) => handleChange(key, e.target.value)}
                                                    className="flex-1"
                                                />
                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-12">
                                                    {(parseFloat(formData[key] || 0.9) * 100).toFixed(0)}%
                                                </span>
                                            </div>
                                        ) : (
                                            <input
                                                type="text"
                                                value={formData[key] || ''}
                                                onChange={(e) => handleChange(key, e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            />
                                        )}
                                        {setting.updated_at && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                Last updated: {new Date(setting.updated_at).toLocaleString()}
                                                {setting.updated_by_username && ` by ${setting.updated_by_username}`}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Preview Note */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Note:</strong> Changes will be reflected immediately after saving. Refresh the public page to see updates.
                </p>
            </div>
        </div>
    );
}
