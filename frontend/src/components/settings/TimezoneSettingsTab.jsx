import { useState, useEffect } from 'react';
import { adminAPI } from '../../services/api';
import { Clock, Save, AlertCircle } from 'lucide-react';

export default function TimezoneSettingsTab() {
    const [timezone, setTimezone] = useState('WIB');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        loadTimezone();
    }, []);

    const loadTimezone = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data } = await adminAPI.get('/api/admin/settings/timezone');
            setTimezone(data.data.shortName);
        } catch (error) {
            console.error('Failed to load timezone:', error);
            setError('Gagal memuat pengaturan timezone');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSuccess(false);
        try {
            await adminAPI.put('/api/admin/settings/timezone', { timezone });
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (error) {
            console.error('Failed to update timezone:', error);
            setError('Gagal menyimpan pengaturan timezone');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-6">
                <Clock className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Pengaturan Zona Waktu
                </h2>
            </div>
            
            <div className="space-y-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Zona Waktu
                    </label>
                    <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        disabled={saving}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                                 bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                                 focus:ring-2 focus:ring-blue-500 focus:border-transparent
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <option value="WIB">WIB (Waktu Indonesia Barat - UTC+7)</option>
                        <option value="WITA">WITA (Waktu Indonesia Tengah - UTC+8)</option>
                        <option value="WIT">WIT (Waktu Indonesia Timur - UTC+9)</option>
                    </select>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-800 dark:text-blue-300">
                            <p className="font-medium mb-2">Zona waktu ini akan digunakan untuk:</p>
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>Timestamp pada recording</li>
                                <li>Watermark tanggal/waktu pada video</li>
                                <li>Log audit sistem</li>
                                <li>Laporan analytics dan statistik</li>
                                <li>Tampilan waktu di seluruh aplikasi</li>
                            </ul>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                        <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                    </div>
                )}

                {success && (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                        <p className="text-sm text-green-800 dark:text-green-300">
                            Pengaturan timezone berhasil disimpan
                        </p>
                    </div>
                )}

                <div className="flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg 
                                 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                                 transition-colors"
                    >
                        <Save className="w-4 h-4" />
                        {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
                    </button>
                </div>
            </div>
        </div>
    );
}
