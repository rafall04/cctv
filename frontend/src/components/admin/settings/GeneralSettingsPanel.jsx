import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNotification } from '../../../contexts/NotificationContext';
import { adminAPI } from '../../../services/api';

const getApiUrl = () => {
    return import.meta.env.VITE_API_URL || 'http://localhost:3000';
};

export default function GeneralSettingsPanel() {
    const { success, error: showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        landing_area_coverage: '',
        landing_hero_badge: '',
        landing_section_title: '',
    });

    const fetchSettings = useCallback(async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${getApiUrl()}/api/settings/landing-page`);
            const data = response.data.data;
            setSettings({
                landing_area_coverage: data.area_coverage || '',
                landing_hero_badge: data.hero_badge || '',
                landing_section_title: data.section_title || '',
            });
        } catch (requestError) {
            console.error('Error fetching settings:', requestError);
            showError('Gagal Memuat', 'Gagal memuat pengaturan landing page');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            setSaving(true);
            await Promise.all([
                adminAPI.put('/api/settings/landing_area_coverage', {
                    value: settings.landing_area_coverage,
                    description: 'Area coverage text displayed on landing page hero section',
                }),
                adminAPI.put('/api/settings/landing_hero_badge', {
                    value: settings.landing_hero_badge,
                    description: 'Badge text displayed above hero title',
                }),
                adminAPI.put('/api/settings/landing_section_title', {
                    value: settings.landing_section_title,
                    description: 'Main section title for camera list',
                }),
            ]);
            success('Pengaturan Tersimpan', 'Pengaturan landing page berhasil disimpan.');
        } catch (requestError) {
            console.error('Error saving settings:', requestError);
            showError('Gagal Menyimpan', 'Gagal menyimpan pengaturan landing page');
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (event) => {
        const { name, value } = event.target;
        setSettings((prev) => ({
            ...prev,
            [name]: value,
        }));
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Landing Page Settings</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Customize text displayed on public landing page.</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div>
                    <label htmlFor="landing_hero_badge" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Hero Badge Text</label>
                    <input
                        type="text"
                        id="landing_hero_badge"
                        name="landing_hero_badge"
                        value={settings.landing_hero_badge}
                        onChange={handleChange}
                        placeholder="LIVE STREAMING 24 JAM"
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all"
                    />
                </div>

                <div>
                    <label htmlFor="landing_section_title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Section Title</label>
                    <input
                        type="text"
                        id="landing_section_title"
                        name="landing_section_title"
                        value={settings.landing_section_title}
                        onChange={handleChange}
                        placeholder="CCTV Publik"
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all"
                    />
                </div>

                <div>
                    <label htmlFor="landing_area_coverage" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Area Coverage Text</label>
                    <textarea
                        id="landing_area_coverage"
                        name="landing_area_coverage"
                        value={settings.landing_area_coverage}
                        onChange={handleChange}
                        rows={3}
                        placeholder="Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>"
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all resize-none"
                    />
                </div>

                <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                    <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                        <div>
                            <span className="font-medium">Hero Badge:</span>
                            <div className="mt-1 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                                {settings.landing_hero_badge || 'LIVE STREAMING 24 JAM'}
                            </div>
                        </div>
                        <div>
                            <span className="font-medium">Section Title:</span> {settings.landing_section_title || 'CCTV Publik'}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={fetchSettings}
                        disabled={saving}
                        className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                        Reset Form
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl transition-colors disabled:opacity-60"
                    >
                        {saving ? 'Menyimpan...' : 'Simpan'}
                    </button>
                </div>
            </form>
        </div>
    );
}
