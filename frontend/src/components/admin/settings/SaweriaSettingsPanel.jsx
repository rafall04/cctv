import { useState, useEffect, useCallback } from 'react';
import { saweriaService } from '../../../services/saweriaService';
import { useNotification } from '../../../contexts/NotificationContext';
import { FormSkeleton } from '../../ui/Skeleton';

export default function SaweriaSettingsPanel() {
    const { success, error: showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        saweria_link: '',
        leaderboard_link: '',
        enabled: true,
    });

    const fetchSettings = useCallback(async () => {
        try {
            setLoading(true);
            const response = await saweriaService.getSaweriaSettings();
            if (!response.success) {
                showError('Gagal Memuat', response.message || 'Gagal memuat pengaturan Saweria');
                return;
            }

            setSettings({
                saweria_link: response.data.saweria_link || '',
                leaderboard_link: response.data.leaderboard_link || '',
                enabled: response.data.enabled === 1,
            });
        } catch (requestError) {
            console.error('Error fetching Saweria settings:', requestError);
            showError('Gagal Memuat', 'Gagal memuat pengaturan Saweria');
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
            const response = await saweriaService.updateSaweriaSettings(settings);
            if (!response.success) {
                showError('Gagal Menyimpan', response.message || 'Gagal menyimpan pengaturan Saweria');
                return;
            }
            success('Saweria Tersimpan', 'Pengaturan Saweria berhasil disimpan.');
        } catch (requestError) {
            console.error('Error saving Saweria settings:', requestError);
            showError('Gagal Menyimpan', 'Gagal menyimpan pengaturan Saweria');
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        setSettings((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
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
            <div>
                <p className="text-sm font-semibold text-sky-500 mb-1">Integrasi Donasi</p>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Pengaturan Saweria</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1">Kelola link donasi Saweria untuk website Anda.</p>
            </div>

            <div className="p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl">
                <h3 className="font-semibold text-blue-900 dark:text-blue-400 mb-2">Cara setup Saweria</h3>
                <ol className="text-sm text-blue-800 dark:text-blue-400 space-y-1 list-decimal list-inside">
                    <li>Buat akun di <a href="https://saweria.co/" target="_blank" rel="noopener noreferrer" className="underline">Saweria.co</a>.</li>
                    <li>Salin link profil atau leaderboard Saweria Anda.</li>
                    <li>Masukkan link tersebut pada form di bawah.</li>
                </ol>
            </div>

            <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
                <div className="p-6 space-y-6">
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
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900 dark:text-white"
                        />
                    </div>

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
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-900 dark:text-white"
                        />
                    </div>

                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                        <div className="flex-1">
                            <label htmlFor="enabled" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aktifkan Popup Saweria</label>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Tampilkan popup donasi Saweria di halaman publik.</p>
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

                    {settings.saweria_link && (
                        <div className="p-4 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-500/10 dark:to-amber-500/10 border border-orange-200 dark:border-orange-500/20 rounded-xl">
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Preview Link</h4>
                            <a
                                href={settings.saweria_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold rounded-lg transition-all duration-300 shadow-md text-sm"
                            >
                                <span>Buka halaman Saweria</span>
                            </a>
                        </div>
                    )}

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
                </div>
            </form>
        </div>
    );
}
