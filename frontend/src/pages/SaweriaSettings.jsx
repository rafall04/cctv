import { useState, useEffect } from 'react';
import { saweriaService } from '../services/saweriaService';
import { useNotification } from '../contexts/NotificationContext';
import { FormSkeleton } from '../components/ui/Skeleton';

export default function SaweriaSettings() {
    const { addNotification } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        saweria_link: '',
        leaderboard_link: '',
        enabled: true
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const response = await saweriaService.getSaweriaSettings();
            
            if (response.success) {
                setSettings({
                    saweria_link: response.data.saweria_link || '',
                    leaderboard_link: response.data.leaderboard_link || '',
                    enabled: response.data.enabled === 1
                });
            }
        } catch (error) {
            console.error('Error fetching Saweria settings:', error);
            addNotification('Gagal memuat pengaturan Saweria', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        try {
            setSaving(true);
            const response = await saweriaService.updateSaweriaSettings(settings);
            
            if (response.success) {
                addNotification('Pengaturan Saweria berhasil disimpan', 'success');
            } else {
                addNotification(response.message || 'Gagal menyimpan pengaturan', 'error');
            }
        } catch (error) {
            console.error('Error saving Saweria settings:', error);
            addNotification('Gagal menyimpan pengaturan Saweria', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setSettings(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    if (loading) {
        return (
            <div className="p-6">
                <FormSkeleton fields={5} />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-500 mb-1">Integrasi Donasi</p>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Pengaturan Saweria</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Kelola link donasi Saweria untuk website Anda
                    </p>
                </div>
            </div>

            {/* Info Box */}
            <div className="p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl">
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center text-white">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <h3 className="font-semibold text-blue-900 dark:text-blue-400 mb-1">
                            Cara Setup Saweria
                        </h3>
                        <ol className="text-sm text-blue-800 dark:text-blue-400 space-y-1 list-decimal list-inside">
                            <li>Buat akun di <a href="https://saweria.co/" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">Saweria.co</a></li>
                            <li>Dapatkan link profil Saweria Anda (contoh: https://saweria.co/username)</li>
                            <li>Masukkan link tersebut di form di bawah</li>
                            <li>Aktifkan toggle untuk menampilkan popup donasi</li>
                        </ol>
                    </div>
                </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
                <div className="p-6 space-y-6">
                    {/* Saweria Link */}
                    <div>
                        <label htmlFor="saweria_link" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Link Saweria <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="url"
                            id="saweria_link"
                            name="saweria_link"
                            value={settings.saweria_link}
                            onChange={handleChange}
                            placeholder="https://saweria.co/username"
                            required
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                        />
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                            Masukkan link profil Saweria Anda (harus dimulai dengan http:// atau https://)
                        </p>
                    </div>

                    {/* Leaderboard Link */}
                    <div>
                        <label htmlFor="leaderboard_link" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Link Leaderboard Saweria
                        </label>
                        <input
                            type="url"
                            id="leaderboard_link"
                            name="leaderboard_link"
                            value={settings.leaderboard_link}
                            onChange={handleChange}
                            placeholder="https://saweria.co/overlays/leaderboard/username"
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                        />
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                            Link leaderboard akan ditampilkan di halaman publik (opsional)
                        </p>
                    </div>

                    {/* Enable/Disable */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                        <div className="flex-1">
                            <label htmlFor="enabled" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Aktifkan Popup Saweria
                            </label>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Tampilkan popup donasi Saweria di halaman publik
                            </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                id="enabled"
                                name="enabled"
                                checked={settings.enabled}
                                onChange={handleChange}
                                className="sr-only peer"
                            />
                            <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 dark:peer-focus:ring-sky-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all dark:border-gray-600 peer-checked:bg-sky-500"></div>
                        </label>
                    </div>

                    {/* Preview */}
                    {settings.saweria_link && (
                        <div className="p-4 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-500/10 dark:to-amber-500/10 border border-orange-200 dark:border-orange-500/20 rounded-xl">
                            <div className="flex items-center gap-3 mb-3">
                                <span className="text-2xl">☕</span>
                                <div>
                                    <h4 className="font-semibold text-gray-900 dark:text-white">Preview Link</h4>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">Link ini akan digunakan di popup dan footer</p>
                                </div>
                            </div>
                            <a
                                href={settings.saweria_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 shadow-md text-sm"
                            >
                                <span>☕</span>
                                <span>Traktir Kopi Yuk!</span>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                            </a>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700/50 flex justify-end gap-3">
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
                        className="px-6 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-lg shadow-sky-500/30"
                    >
                        {saving ? (
                            <span className="flex items-center gap-2">
                                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Menyimpan...
                            </span>
                        ) : (
                            'Simpan Pengaturan'
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
