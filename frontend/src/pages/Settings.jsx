import { useState, useEffect, useCallback } from 'react';
import { adminService } from '../services/adminService';
import { Skeleton } from '../components/ui/Skeleton';
import { Alert } from '../components/ui/Alert';

export default function Settings() {
    const [telegramStatus, setTelegramStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testLoading, setTestLoading] = useState({ monitoring: false, feedback: false });
    const [testResult, setTestResult] = useState(null);
    const [error, setError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);
    
    // Form state
    const [formData, setFormData] = useState({
        botToken: '',
        monitoringChatId: '',
        feedbackChatId: ''
    });
    const [isEditing, setIsEditing] = useState(false);

    const loadTelegramStatus = useCallback(async () => {
        try {
            const response = await adminService.getTelegramStatus();
            if (response.success) {
                setTelegramStatus(response.data);
                setFormData({
                    botToken: response.data.botToken || '',
                    monitoringChatId: response.data.monitoringChatId || '',
                    feedbackChatId: response.data.feedbackChatId || ''
                });
                setError(null);
            } else {
                setError(response.message || 'Gagal memuat status Telegram');
            }
        } catch (err) {
            setError('Gagal terhubung ke server');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTelegramStatus();
    }, [loadTelegramStatus]);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSuccessMsg(null);
        
        try {
            const response = await adminService.updateTelegramConfig(formData);
            if (response.success) {
                setSuccessMsg('Konfigurasi berhasil disimpan!');
                setTelegramStatus(response.data);
                setIsEditing(false);
            } else {
                setError(response.message || 'Gagal menyimpan konfigurasi');
            }
        } catch (err) {
            setError('Gagal terhubung ke server');
        } finally {
            setSaving(false);
        }
    };

    const handleTestNotification = async (type) => {
        setTestLoading(prev => ({ ...prev, [type]: true }));
        setTestResult(null);
        
        try {
            const response = await adminService.testTelegramNotification(type);
            if (response.success) {
                setTestResult({ type: 'success', message: response.message || 'Notifikasi test berhasil dikirim!' });
            } else {
                setTestResult({ type: 'error', message: response.message || 'Gagal mengirim notifikasi test' });
            }
        } catch (err) {
            setTestResult({ type: 'error', message: 'Gagal terhubung ke server' });
        } finally {
            setTestLoading(prev => ({ ...prev, [type]: false }));
        }
    };

    const handleCancel = () => {
        setFormData({
            botToken: telegramStatus?.botToken || '',
            monitoringChatId: telegramStatus?.monitoringChatId || '',
            feedbackChatId: telegramStatus?.feedbackChatId || ''
        });
        setIsEditing(false);
        setError(null);
    };

    if (loading) {
        return (
            <div className="space-y-8">
                <div>
                    <Skeleton variant="text" className="h-4 w-24 mb-2" />
                    <Skeleton variant="text" className="h-8 w-48 mb-2" />
                    <Skeleton variant="text" className="h-4 w-64" />
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <Skeleton variant="text" className="h-6 w-40 mb-4" />
                    <div className="space-y-4">
                        <Skeleton variant="rectangular" className="h-20 w-full rounded-xl" />
                        <Skeleton variant="rectangular" className="h-20 w-full rounded-xl" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <p className="text-sm font-semibold text-sky-500 mb-1">Pengaturan</p>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Konfigurasi Sistem</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                    Kelola pengaturan notifikasi dan integrasi
                </p>
            </div>

            {/* Alerts */}
            {error && (
                <Alert type="error" title="Error" message={error} dismissible onDismiss={() => setError(null)} />
            )}
            {successMsg && (
                <Alert type="success" title="Berhasil" message={successMsg} dismissible onDismiss={() => setSuccessMsg(null)} />
            )}
            {testResult && (
                <Alert
                    type={testResult.type}
                    title={testResult.type === 'success' ? 'Berhasil' : 'Gagal'}
                    message={testResult.message}
                    dismissible
                    onDismiss={() => setTestResult(null)}
                />
            )}

            {/* Telegram Configuration */}
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Telegram Bot</h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Notifikasi status kamera dan kritik saran</p>
                            </div>
                        </div>
                        {!isEditing && (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-xl transition-colors flex items-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Edit
                            </button>
                        )}
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {isEditing ? (
                        /* Edit Form */
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Bot Token
                                </label>
                                <input
                                    type="text"
                                    value={formData.botToken}
                                    onChange={(e) => setFormData(prev => ({ ...prev, botToken: e.target.value }))}
                                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    Dapatkan dari @BotFather di Telegram
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Chat ID Monitoring Kamera
                                </label>
                                <input
                                    type="text"
                                    value={formData.monitoringChatId}
                                    onChange={(e) => setFormData(prev => ({ ...prev, monitoringChatId: e.target.value }))}
                                    placeholder="-1001234567890"
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    Untuk notifikasi kamera offline/online
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Chat ID Kritik & Saran
                                </label>
                                <input
                                    type="text"
                                    value={formData.feedbackChatId}
                                    onChange={(e) => setFormData(prev => ({ ...prev, feedbackChatId: e.target.value }))}
                                    placeholder="-1009876543210"
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    Untuk notifikasi feedback baru (bisa sama dengan monitoring)
                                </p>
                            </div>

                            <div className="flex items-center gap-3 pt-4">
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white font-medium rounded-xl transition-colors flex items-center gap-2"
                                >
                                    {saving ? (
                                        <>
                                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Menyimpan...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                            </svg>
                                            Simpan
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={handleCancel}
                                    disabled={saving}
                                    className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-xl transition-colors"
                                >
                                    Batal
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Status View */
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Monitoring Status */}
                                <div className={`p-4 rounded-xl border ${
                                    telegramStatus?.monitoringConfigured 
                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' 
                                        : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                                }`}>
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className={`w-3 h-3 rounded-full ${
                                            telegramStatus?.monitoringConfigured ? 'bg-emerald-500' : 'bg-gray-400'
                                        }`}></div>
                                        <span className="font-semibold text-gray-900 dark:text-white">Monitoring Kamera</span>
                                    </div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                                        Notifikasi saat kamera offline/online
                                    </p>
                                    {telegramStatus?.monitoringConfigured ? (
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                                ✓ Chat ID: {telegramStatus.monitoringChatId}
                                            </p>
                                            <button
                                                onClick={() => handleTestNotification('monitoring')}
                                                disabled={testLoading.monitoring}
                                                className="text-xs px-2 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition-colors"
                                            >
                                                {testLoading.monitoring ? 'Mengirim...' : 'Test'}
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500">✗ Belum dikonfigurasi</p>
                                    )}
                                </div>

                                {/* Feedback Status */}
                                <div className={`p-4 rounded-xl border ${
                                    telegramStatus?.feedbackConfigured 
                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' 
                                        : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                                }`}>
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className={`w-3 h-3 rounded-full ${
                                            telegramStatus?.feedbackConfigured ? 'bg-emerald-500' : 'bg-gray-400'
                                        }`}></div>
                                        <span className="font-semibold text-gray-900 dark:text-white">Kritik & Saran</span>
                                    </div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                                        Notifikasi saat ada feedback baru
                                    </p>
                                    {telegramStatus?.feedbackConfigured ? (
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                                ✓ Chat ID: {telegramStatus.feedbackChatId}
                                            </p>
                                            <button
                                                onClick={() => handleTestNotification('feedback')}
                                                disabled={testLoading.feedback}
                                                className="text-xs px-2 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition-colors"
                                            >
                                                {testLoading.feedback ? 'Mengirim...' : 'Test'}
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500">✗ Belum dikonfigurasi</p>
                                    )}
                                </div>
                            </div>

                            {/* Bot Token Info */}
                            {telegramStatus?.botToken && (
                                <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                        <span className="font-medium">Bot Token:</span> {telegramStatus.botToken}
                                    </p>
                                </div>
                            )}
                        </>
                    )}

                    {/* Help Guide */}
                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 bg-amber-100 dark:bg-amber-500/20 rounded-lg flex items-center justify-center text-amber-600 dark:text-amber-400 flex-shrink-0">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="font-semibold text-amber-800 dark:text-amber-300 mb-1">Cara Mendapatkan Bot Token & Chat ID</h3>
                                <ol className="list-decimal list-inside space-y-1 text-sm text-amber-700 dark:text-amber-400">
                                    <li>Buka <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-600">@BotFather</a> di Telegram</li>
                                    <li>Kirim <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-500/20 rounded">/newbot</code> dan ikuti instruksi</li>
                                    <li>Salin token yang diberikan (format: 123456789:ABC...)</li>
                                    <li>Tambahkan bot ke grup/channel yang diinginkan</li>
                                    <li>Untuk Chat ID, gunakan <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-600">@userinfobot</a> atau forward pesan dari grup ke bot</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Feature List */}
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Fitur Notifikasi</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FeatureItem icon="🔴" title="Kamera Offline" description="Notifikasi otomatis saat kamera terputus" enabled={telegramStatus?.monitoringConfigured} />
                    <FeatureItem icon="🟢" title="Kamera Online" description="Notifikasi saat kamera kembali terhubung" enabled={telegramStatus?.monitoringConfigured} />
                    <FeatureItem icon="📬" title="Kritik & Saran" description="Notifikasi saat ada feedback baru" enabled={telegramStatus?.feedbackConfigured} />
                    <FeatureItem icon="⏰" title="Cooldown 5 Menit" description="Mencegah spam notifikasi" enabled={telegramStatus?.enabled} />
                </div>
            </div>
        </div>
    );
}

function FeatureItem({ icon, title, description, enabled }) {
    return (
        <div className={`flex items-start gap-3 p-3 rounded-xl ${enabled ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-gray-50/50 dark:bg-gray-800/30 opacity-60'}`}>
            <span className="text-2xl">{icon}</span>
            <div>
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-white">{title}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${enabled ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                        {enabled ? 'AKTIF' : 'NONAKTIF'}
                    </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
            </div>
        </div>
    );
}
