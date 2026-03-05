import { useState, useEffect, useCallback } from 'react';
import { adminService } from '../../../services/adminService';
import { Skeleton } from '../../ui/Skeleton';
import { Alert } from '../../ui/Alert';

function FeatureItem({ title, description, enabled }) {
    return (
        <div className={`flex items-start gap-3 p-3 rounded-xl ${enabled ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-gray-50/50 dark:bg-gray-800/30 opacity-60'}`}>
            <div className={`mt-1 h-2.5 w-2.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-gray-400'}`}></div>
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

export default function TelegramSettingsPanel() {
    const [telegramStatus, setTelegramStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testLoading, setTestLoading] = useState({ monitoring: false, feedback: false });
    const [testResult, setTestResult] = useState(null);
    const [error, setError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({
        botToken: '',
        monitoringChatId: '',
        feedbackChatId: '',
    });

    const loadTelegramStatus = useCallback(async () => {
        try {
            setLoading(true);
            const response = await adminService.getTelegramStatus();
            if (!response.success) {
                setError(response.message || 'Gagal memuat status Telegram');
                return;
            }

            setTelegramStatus(response.data);
            setFormData({
                botToken: response.data.botToken || '',
                monitoringChatId: response.data.monitoringChatId || '',
                feedbackChatId: response.data.feedbackChatId || '',
            });
            setError(null);
        } catch (requestError) {
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
            if (!response.success) {
                setError(response.message || 'Gagal menyimpan konfigurasi');
                return;
            }

            setSuccessMsg('Konfigurasi berhasil disimpan.');
            setTelegramStatus(response.data);
            setIsEditing(false);
        } catch (requestError) {
            setError('Gagal terhubung ke server');
        } finally {
            setSaving(false);
        }
    };

    const handleTestNotification = async (type) => {
        setTestLoading((prev) => ({ ...prev, [type]: true }));
        setTestResult(null);

        try {
            const response = await adminService.testTelegramNotification(type);
            setTestResult({
                type: response.success ? 'success' : 'error',
                message: response.message || (response.success ? 'Notifikasi test berhasil dikirim.' : 'Gagal mengirim notifikasi test'),
            });
        } catch (requestError) {
            setTestResult({ type: 'error', message: 'Gagal terhubung ke server' });
        } finally {
            setTestLoading((prev) => ({ ...prev, [type]: false }));
        }
    };

    const handleCancel = () => {
        setFormData({
            botToken: telegramStatus?.botToken || '',
            monitoringChatId: telegramStatus?.monitoringChatId || '',
            feedbackChatId: telegramStatus?.feedbackChatId || '',
        });
        setError(null);
        setIsEditing(false);
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
            {error && <Alert type="error" title="Error" message={error} dismissible onDismiss={() => setError(null)} />}
            {successMsg && <Alert type="success" title="Berhasil" message={successMsg} dismissible onDismiss={() => setSuccessMsg(null)} />}
            {testResult && (
                <Alert
                    type={testResult.type}
                    title={testResult.type === 'success' ? 'Berhasil' : 'Gagal'}
                    message={testResult.message}
                    dismissible
                    onDismiss={() => setTestResult(null)}
                />
            )}

            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700/50">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Telegram Bot</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Notifikasi status kamera dan kritik saran</p>
                        </div>
                        {!isEditing && (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-xl transition-colors"
                            >
                                Edit
                            </button>
                        )}
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {isEditing ? (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Bot Token</label>
                                <input
                                    type="text"
                                    value={formData.botToken}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, botToken: event.target.value }))}
                                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Chat ID Monitoring Kamera</label>
                                <input
                                    type="text"
                                    value={formData.monitoringChatId}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, monitoringChatId: event.target.value }))}
                                    placeholder="-1001234567890"
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Chat ID Kritik dan Saran</label>
                                <input
                                    type="text"
                                    value={formData.feedbackChatId}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, feedbackChatId: event.target.value }))}
                                    placeholder="-1009876543210"
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                />
                            </div>

                            <div className="flex items-center gap-3 pt-4">
                                <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 bg-primary hover:bg-primary-600 disabled:bg-blue-400 text-white font-medium rounded-xl transition-colors">
                                    {saving ? 'Menyimpan...' : 'Simpan'}
                                </button>
                                <button onClick={handleCancel} disabled={saving} className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-xl transition-colors">
                                    Batal
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[
                                {
                                    key: 'monitoring',
                                    title: 'Monitoring Kamera',
                                    description: 'Notifikasi saat kamera offline atau online',
                                    configured: telegramStatus?.monitoringConfigured,
                                    chatId: telegramStatus?.monitoringChatId,
                                },
                                {
                                    key: 'feedback',
                                    title: 'Kritik dan Saran',
                                    description: 'Notifikasi saat ada feedback baru',
                                    configured: telegramStatus?.feedbackConfigured,
                                    chatId: telegramStatus?.feedbackChatId,
                                },
                            ].map((item) => (
                                <div
                                    key={item.key}
                                    className={`p-4 rounded-xl border ${item.configured ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'}`}
                                >
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className={`w-3 h-3 rounded-full ${item.configured ? 'bg-emerald-500' : 'bg-gray-400'}`}></div>
                                        <span className="font-semibold text-gray-900 dark:text-white">{item.title}</span>
                                    </div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{item.description}</p>
                                    {item.configured ? (
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-xs text-emerald-600 dark:text-emerald-400 truncate">Chat ID: {item.chatId}</p>
                                            <button
                                                onClick={() => handleTestNotification(item.key)}
                                                disabled={testLoading[item.key]}
                                                className="text-xs px-2 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition-colors"
                                            >
                                                {testLoading[item.key] ? 'Mengirim...' : 'Test'}
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500">Belum dikonfigurasi</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
                        <h3 className="font-semibold text-amber-800 dark:text-amber-300 mb-2">Cara mendapatkan token dan Chat ID</h3>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-amber-700 dark:text-amber-400">
                            <li>Buka <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="underline">@BotFather</a> di Telegram.</li>
                            <li>Kirim <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-500/20 rounded">/newbot</code> lalu ikuti instruksi.</li>
                            <li>Tambahkan bot ke grup atau channel tujuan.</li>
                            <li>Gunakan <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="underline">@userinfobot</a> untuk mengetahui Chat ID.</li>
                        </ol>
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Fitur Notifikasi</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FeatureItem title="Kamera Offline" description="Notifikasi otomatis saat kamera terputus." enabled={telegramStatus?.monitoringConfigured} />
                    <FeatureItem title="Kamera Online" description="Notifikasi saat kamera kembali terhubung." enabled={telegramStatus?.monitoringConfigured} />
                    <FeatureItem title="Kritik dan Saran" description="Notifikasi saat ada feedback baru." enabled={telegramStatus?.feedbackConfigured} />
                    <FeatureItem title="Cooldown 5 Menit" description="Mengurangi spam notifikasi berulang." enabled={telegramStatus?.enabled} />
                </div>
            </div>
        </div>
    );
}
