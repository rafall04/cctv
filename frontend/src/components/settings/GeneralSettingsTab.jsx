import { useState, useEffect } from 'react';
import { useNotification } from '../../contexts/NotificationContext';
import { adminAPI } from '../../services/api';
import axios from 'axios';

const getApiUrl = () => {
    return import.meta.env.VITE_API_URL || 'http://localhost:3000';
};

export default function GeneralSettingsTab() {
    const { addNotification } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        landing_area_coverage: '',
        landing_hero_badge: '',
        landing_section_title: ''
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const baseUrl = getApiUrl();
            
            // Use public endpoint that returns all landing page settings
            const response = await axios.get(`${baseUrl}/api/settings/landing-page`);
            const data = response.data.data;

            setSettings({
                landing_area_coverage: data.area_coverage || '',
                landing_hero_badge: data.hero_badge || '',
                landing_section_title: data.section_title || ''
            });
        } catch (error) {
            console.error('Error fetching settings:', error);
            addNotification('Gagal memuat pengaturan', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        try {
            setSaving(true);
            
            await Promise.all([
                adminAPI.put('/api/settings/landing_area_coverage', {
                    value: settings.landing_area_coverage,
                    description: 'Area coverage text displayed on landing page hero section'
                }),
                adminAPI.put('/api/settings/landing_hero_badge', {
                    value: settings.landing_hero_badge,
                    description: 'Badge text displayed above hero title'
                }),
                adminAPI.put('/api/settings/landing_section_title', {
                    value: settings.landing_section_title,
                    description: 'Main section title for camera list'
                })
            ]);

            addNotification('Pengaturan berhasil disimpan', 'success');
        } catch (error) {
            console.error('Error saving settings:', error);
            addNotification('Gagal menyimpan pengaturan', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSettings(prev => ({
            ...prev,
            [name]: value
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Landing Page Settings
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Customize text displayed on public landing page
                </p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* Hero Badge */}
                <div>
                    <label htmlFor="landing_hero_badge" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Hero Badge Text
                    </label>
                    <input
                        type="text"
                        id="landing_hero_badge"
                        name="landing_hero_badge"
                        value={settings.landing_hero_badge}
                        onChange={handleChange}
                        placeholder="LIVE STREAMING 24 JAM"
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Badge displayed above hero title
                    </p>
                </div>

                {/* Section Title */}
                <div>
                    <label htmlFor="landing_section_title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Section Title
                    </label>
                    <input
                        type="text"
                        id="landing_section_title"
                        name="landing_section_title"
                        value={settings.landing_section_title}
                        onChange={handleChange}
                        placeholder="CCTV Publik"
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Main section title for camera list
                    </p>
                </div>

                {/* Area Coverage */}
                <div>
                    <label htmlFor="landing_area_coverage" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Area Coverage Text
                    </label>
                    <textarea
                        id="landing_area_coverage"
                        name="landing_area_coverage"
                        value={settings.landing_area_coverage}
                        onChange={handleChange}
                        rows={3}
                        placeholder="Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>"
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none transition-all resize-none"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Supports HTML tags like &lt;strong&gt; for bold text
                    </p>
                </div>

                {/* Preview */}
                <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                    <div className="flex items-center gap-2 mb-3">
                        <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">Preview</span>
                    </div>
                    <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                        <div>
                            <span className="font-medium">Hero Badge:</span>
                            <div className="mt-1 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                                {settings.landing_hero_badge || 'LIVE STREAMING 24 JAM'}
                            </div>
                        </div>
                        <div>
                            <span className="font-medium">Section Title:</span>
                            <div className="mt-1 text-lg font-bold">{settings.landing_section_title || 'CCTV Publik'}</div>
                        </div>
                        <div>
                            <span className="font-medium">Area Coverage:</span>
                            <div 
                                className="mt-1 text-sm text-amber-700 dark:text-amber-400"
                                dangerouslySetInnerHTML={{ __html: settings.landing_area_coverage || 'Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                        type="button"
                        onClick={fetchSettings}
                        disabled={saving}
                        className="px-6 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                    >
                        Reset
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="px-6 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-xl hover:from-sky-600 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-lg shadow-sky-500/30"
                    >
                        {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
                    </button>
                </div>
            </form>
        </div>
    );
}
