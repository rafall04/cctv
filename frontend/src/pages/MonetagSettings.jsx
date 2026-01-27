import { useState, useEffect } from 'react';
import { monetagService } from '../services/monetagService';
import { useNotification } from '../contexts/NotificationContext';
import AdminLayout from '../components/AdminLayout';

function MonetagSettings() {
    const { addNotification } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        popunder_enabled: true,
        popunder_zone_id: '',
        native_banner_enabled: true,
        native_banner_zone_id: '',
        push_notifications_enabled: false,
        push_notifications_zone_id: '',
        social_bar_enabled: false,
        social_bar_zone_id: '',
        direct_link_enabled: false,
        direct_link_zone_id: ''
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const response = await monetagService.getMonetagSettings();
            if (response.success) {
                setSettings({
                    popunder_enabled: response.data.popunder_enabled === 1,
                    popunder_zone_id: response.data.popunder_zone_id || '',
                    native_banner_enabled: response.data.native_banner_enabled === 1,
                    native_banner_zone_id: response.data.native_banner_zone_id || '',
                    push_notifications_enabled: response.data.push_notifications_enabled === 1,
                    push_notifications_zone_id: response.data.push_notifications_zone_id || '',
                    social_bar_enabled: response.data.social_bar_enabled === 1,
                    social_bar_zone_id: response.data.social_bar_zone_id || '',
                    direct_link_enabled: response.data.direct_link_enabled === 1,
                    direct_link_zone_id: response.data.direct_link_zone_id || ''
                });
            }
        } catch (error) {
            console.error('Error fetching Monetag settings:', error);
            addNotification('Gagal memuat pengaturan Monetag', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        try {
            setSaving(true);
            const response = await monetagService.updateMonetagSettings(settings);
            
            if (response.success) {
                addNotification('Pengaturan Monetag berhasil disimpan', 'success');
            } else {
                addNotification(response.message || 'Gagal menyimpan pengaturan', 'error');
            }
        } catch (error) {
            console.error('Error saving Monetag settings:', error);
            addNotification('Gagal menyimpan pengaturan Monetag', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = (field) => {
        setSettings(prev => ({
            ...prev,
            [field]: !prev[field]
        }));
    };

    const handleZoneIdChange = (field, value) => {
        setSettings(prev => ({
            ...prev,
            [field]: value
        }));
    };

    if (loading) {
        return (
            <AdminLayout>
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
                </div>
            </AdminLayout>
        );
    }

    return (
        <AdminLayout>
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Pengaturan Monetag
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Kelola konfigurasi iklan Monetag untuk website Anda
                    </p>
                </div>

                {/* Info Banner */}
                <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="flex-1">
                            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-1">
                                Cara Mendapatkan Zone ID
                            </h3>
                            <ol className="text-sm text-blue-800 dark:text-blue-400 space-y-1 list-decimal list-inside">
                                <li>Login ke <a href="https://www.monetag.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">Monetag Dashboard</a></li>
                                <li>Pilih menu "Ad Zones" → "Create Zone"</li>
                                <li>Pilih format iklan yang diinginkan</li>
                                <li>Copy Zone ID dan paste di form ini</li>
                            </ol>
                        </div>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Popunder Settings */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                        Popunder
                                    </h3>
                                    <span className="px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded-full">
                                        RECOMMENDED
                                    </span>
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Tab baru di belakang (tidak mengganggu). CPM tertinggi: $3-8
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.popunder_enabled}
                                    onChange={() => handleToggle('popunder_enabled')}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                            </label>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Zone ID
                            </label>
                            <input
                                type="text"
                                value={settings.popunder_zone_id}
                                onChange={(e) => handleZoneIdChange('popunder_zone_id', e.target.value)}
                                placeholder="Contoh: 8360606"
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                disabled={!settings.popunder_enabled}
                            />
                        </div>
                    </div>

                    {/* Native Banner Settings */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                        Native Banner
                                    </h3>
                                    <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded-full">
                                        OPTIMAL
                                    </span>
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Banner di bawah video saat play. CPM: $1-3
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.native_banner_enabled}
                                    onChange={() => handleToggle('native_banner_enabled')}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                            </label>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Zone ID
                            </label>
                            <input
                                type="text"
                                value={settings.native_banner_zone_id}
                                onChange={(e) => handleZoneIdChange('native_banner_zone_id', e.target.value)}
                                placeholder="Contoh: 8360607"
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                disabled={!settings.native_banner_enabled}
                            />
                        </div>
                    </div>

                    {/* Push Notifications Settings */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                        Push Notifications
                                    </h3>
                                    <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded-full">
                                        OPTIONAL
                                    </span>
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Notifikasi browser (perlu izin user). CPM: $2-5
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.push_notifications_enabled}
                                    onChange={() => handleToggle('push_notifications_enabled')}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                            </label>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Zone ID
                            </label>
                            <input
                                type="text"
                                value={settings.push_notifications_zone_id}
                                onChange={(e) => handleZoneIdChange('push_notifications_zone_id', e.target.value)}
                                placeholder="Contoh: 8360609"
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                disabled={!settings.push_notifications_enabled}
                            />
                        </div>
                    </div>

                    {/* Social Bar Settings */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                        Social Bar
                                    </h3>
                                    <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-400 rounded-full">
                                        NOT RECOMMENDED
                                    </span>
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Sticky bar di bawah (bisa mengganggu). CPM: $1-2
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.social_bar_enabled}
                                    onChange={() => handleToggle('social_bar_enabled')}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                            </label>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Zone ID
                            </label>
                            <input
                                type="text"
                                value={settings.social_bar_zone_id}
                                onChange={(e) => handleZoneIdChange('social_bar_zone_id', e.target.value)}
                                placeholder="Contoh: 8360610"
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                disabled={!settings.social_bar_enabled}
                            />
                        </div>
                    </div>

                    {/* Direct Link Settings */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                        Direct Link
                                    </h3>
                                    <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-400 rounded-full">
                                        OPTIONAL
                                    </span>
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Banner ads standard. CPM: $1-2
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.direct_link_enabled}
                                    onChange={() => handleToggle('direct_link_enabled')}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                            </label>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Zone ID
                            </label>
                            <input
                                type="text"
                                value={settings.direct_link_zone_id}
                                onChange={(e) => handleZoneIdChange('direct_link_zone_id', e.target.value)}
                                placeholder="Contoh: 8360608"
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                disabled={!settings.direct_link_enabled}
                            />
                        </div>
                    </div>

                    {/* Submit Button */}
                    <div className="flex items-center justify-end gap-4 pt-4">
                        <button
                            type="button"
                            onClick={fetchSettings}
                            className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            disabled={saving}
                        >
                            Reset
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {saving ? (
                                <>
                                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Menyimpan...
                                </>
                            ) : (
                                'Simpan Pengaturan'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </AdminLayout>
    );
}

export default MonetagSettings;
