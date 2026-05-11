/**
 * Purpose: Admin panel for Telegram bot settings, multi-target notification groups, and routing rules.
 * Caller: UnifiedSettings Telegram section.
 * Deps: adminService, areaService, UI Skeleton/Alert components.
 * MainFuncs: TelegramSettingsPanel, FeatureItem.
 * SideEffects: Loads/saves Telegram settings and sends test notification requests.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminService } from '../../../services/adminService';
import { areaService } from '../../../services/areaService';
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

function formatTargetOptionLabel(target = {}) {
    const name = target.name || target.id || 'Target Telegram';
    const chatId = target.chatId ? ` (${target.chatId})` : '';
    return `${name}${chatId}`;
}

export default function TelegramSettingsPanel() {
    const [telegramStatus, setTelegramStatus] = useState(null);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testLoading, setTestLoading] = useState({});
    const [testResult, setTestResult] = useState(null);
    const [error, setError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({
        botToken: '',
        monitoringChatId: '',
        feedbackChatId: '',
        notificationTargets: [],
        notificationRules: [],
    });

    const loadTelegramStatus = useCallback(async () => {
        try {
            setLoading(true);
            const [response, areaResponse] = await Promise.all([
                adminService.getTelegramStatus(),
                areaService.getAllAreas(),
            ]);
            if (!response.success) {
                setError(response.message || 'Gagal memuat status Telegram');
                return;
            }

            if (areaResponse?.success) {
                setAreas(areaResponse.data || []);
            }
            setTelegramStatus(response.data);
            setFormData({
                botToken: response.data.botToken || '',
                monitoringChatId: response.data.monitoringChatId || '',
                feedbackChatId: response.data.feedbackChatId || '',
                notificationTargets: response.data.notificationTargets || [],
                notificationRules: response.data.notificationRules || [],
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

    const handleTestNotification = async (type, options = {}) => {
        const loadingKey = options.targetId ? `target:${options.targetId}` : type;
        setTestLoading((prev) => ({ ...prev, [loadingKey]: true }));
        setTestResult(null);

        try {
            const response = await adminService.testTelegramNotification(type, options);
            setTestResult({
                type: response.success ? 'success' : 'error',
                message: response.message || (response.success ? 'Notifikasi test berhasil dikirim.' : 'Gagal mengirim notifikasi test'),
            });
        } catch (requestError) {
            setTestResult({ type: 'error', message: 'Gagal terhubung ke server' });
        } finally {
            setTestLoading((prev) => ({ ...prev, [loadingKey]: false }));
        }
    };

    const handleCancel = () => {
        setFormData({
            botToken: telegramStatus?.botToken || '',
            monitoringChatId: telegramStatus?.monitoringChatId || '',
            feedbackChatId: telegramStatus?.feedbackChatId || '',
            notificationTargets: telegramStatus?.notificationTargets || [],
            notificationRules: telegramStatus?.notificationRules || [],
        });
        setError(null);
        setIsEditing(false);
    };

    const addTarget = () => {
        const id = `target-${Date.now()}`;
        setFormData((prev) => ({
            ...prev,
            notificationTargets: [
                ...(prev.notificationTargets || []),
                { id, name: 'Grup Baru', chatId: '', enabled: true },
            ],
        }));
    };

    const updateTarget = (index, patch) => {
        setFormData((prev) => ({
            ...prev,
            notificationTargets: (prev.notificationTargets || []).map((target, targetIndex) => (
                targetIndex === index ? { ...target, ...patch } : target
            )),
        }));
    };

    const removeTarget = (index) => {
        setFormData((prev) => {
            const target = prev.notificationTargets?.[index];
            return {
                ...prev,
                notificationTargets: (prev.notificationTargets || []).filter((_, targetIndex) => targetIndex !== index),
                notificationRules: (prev.notificationRules || []).filter((rule) => rule.targetId !== target?.id),
            };
        });
    };

    const addRule = () => {
        const firstTarget = formData.notificationTargets?.[0];
        setFormData((prev) => ({
            ...prev,
            notificationRules: [
                ...(prev.notificationRules || []),
                {
                    id: `rule-${Date.now()}`,
                    enabled: true,
                    targetId: firstTarget?.id || 'legacy-monitoring',
                    scope: 'global',
                    areaId: '',
                    cameraId: '',
                    events: ['offline', 'online'],
                    ingestModes: ['always_on'],
                },
            ],
        }));
    };

    const updateRule = (index, patch) => {
        setFormData((prev) => ({
            ...prev,
            notificationRules: (prev.notificationRules || []).map((rule, ruleIndex) => (
                ruleIndex === index ? { ...rule, ...patch } : rule
            )),
        }));
    };

    const toggleRuleEvent = (index, eventName) => {
        setFormData((prev) => ({
            ...prev,
            notificationRules: (prev.notificationRules || []).map((rule, ruleIndex) => {
                if (ruleIndex !== index) return rule;
                const currentEvents = Array.isArray(rule.events) ? rule.events : [];
                const nextEvents = currentEvents.includes(eventName)
                    ? currentEvents.filter((item) => item !== eventName)
                    : [...currentEvents, eventName];
                return { ...rule, events: nextEvents };
            }),
        }));
    };

    const removeRule = (index) => {
        setFormData((prev) => ({
            ...prev,
            notificationRules: (prev.notificationRules || []).filter((_, ruleIndex) => ruleIndex !== index),
        }));
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
            {(telegramStatus?.notificationRuleIssues || []).length > 0 && (
                <Alert
                    type="warning"
                    title="Routing Telegram perlu diperiksa"
                    message={telegramStatus.notificationRuleIssues.map((issue) => issue.message).join(' ')}
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
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <Link
                                    to="/admin/notification-diagnostics"
                                    className="inline-flex items-center rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                                >
                                    Buka Notification Diagnostics
                                </Link>
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-xl transition-colors"
                                >
                                    Edit
                                </button>
                            </div>
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

                            <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="font-semibold text-gray-900 dark:text-white">Target Grup Monitoring</h3>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Tambahkan grup Telegram untuk NOC, area, atau teknisi.</p>
                                    </div>
                                    <button type="button" onClick={addTarget} className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium">
                                        Tambah Grup
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {(formData.notificationTargets || []).map((target, index) => (
                                        <div key={target.id || index} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Nama Grup</label>
                                                <input
                                                    type="text"
                                                    value={target.name || ''}
                                                    onChange={(event) => updateTarget(index, { name: event.target.value, id: target.id || `target-${Date.now()}` })}
                                                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Chat ID</label>
                                                <input
                                                    type="text"
                                                    value={target.chatId || ''}
                                                    onChange={(event) => updateTarget(index, { chatId: event.target.value })}
                                                    placeholder="-1001234567890"
                                                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
                                                />
                                            </div>
                                            <button type="button" onClick={() => removeTarget(index)} className="px-3 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium">
                                                Hapus
                                            </button>
                                        </div>
                                    ))}
                                    {(formData.notificationTargets || []).length === 0 && (
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Belum ada grup tambahan. Chat ID monitoring utama tetap menjadi fallback.</p>
                                    )}
                                </div>
                            </div>

                            <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="font-semibold text-gray-900 dark:text-white">Routing Notifikasi CCTV</h3>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Default rule memakai internal always-on agar on-demand tidak membuat spam.</p>
                                    </div>
                                    <button type="button" onClick={addRule} className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium">
                                        Tambah Rule
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {(formData.notificationRules || []).map((rule, index) => (
                                        <div key={rule.id || index} className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-3 items-end p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Kirim Ke</label>
                                                <select
                                                    value={rule.targetId || 'legacy-monitoring'}
                                                    onChange={(event) => updateRule(index, { targetId: event.target.value })}
                                                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
                                                >
                                                    {formData.monitoringChatId && <option value="legacy-monitoring">Monitoring Utama (Chat ID Monitoring Kamera)</option>}
                                                    {(formData.notificationTargets || []).map((target) => (
                                                        <option key={target.id} value={target.id}>{formatTargetOptionLabel(target)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Scope</label>
                                                <select
                                                    value={rule.scope || 'global'}
                                                    onChange={(event) => updateRule(index, { scope: event.target.value })}
                                                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
                                                >
                                                    <option value="global">Global</option>
                                                    <option value="area">Per Area</option>
                                                    <option value="camera">Per Kamera</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{rule.scope === 'camera' ? 'Camera ID' : 'Area'}</label>
                                                {rule.scope === 'area' ? (
                                                    <select
                                                        value={rule.areaId || ''}
                                                        onChange={(event) => updateRule(index, { areaId: event.target.value })}
                                                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
                                                    >
                                                        <option value="">Pilih Area</option>
                                                        {areas.map((area) => (
                                                            <option key={area.id} value={area.id}>{area.name}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input
                                                        type="number"
                                                        value={rule.scope === 'camera' ? (rule.cameraId || '') : ''}
                                                        disabled={rule.scope !== 'camera'}
                                                        onChange={(event) => updateRule(index, { cameraId: event.target.value })}
                                                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white disabled:opacity-50"
                                                    />
                                                )}
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Ingest</label>
                                                <select
                                                    value={rule.ingestModes?.[0] || 'always_on'}
                                                    onChange={(event) => updateRule(index, { ingestModes: [event.target.value] })}
                                                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
                                                >
                                                    <option value="always_on">Always On</option>
                                                    <option value="on_demand">On Demand</option>
                                                    <option value="any">Semua</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Event</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {['offline', 'online'].map((eventName) => (
                                                        <label key={eventName} className="inline-flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
                                                            <input
                                                                type="checkbox"
                                                                aria-label={`${eventName === 'offline' ? 'Offline' : 'Online'} ${rule.id}`}
                                                                checked={(rule.events || []).includes(eventName)}
                                                                onChange={() => toggleRuleEvent(index, eventName)}
                                                                className="rounded border-gray-300 text-primary focus:ring-primary"
                                                            />
                                                            {eventName === 'offline' ? 'Offline' : 'Online'}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                            <button type="button" onClick={() => removeRule(index)} className="px-3 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium">
                                                Hapus
                                            </button>
                                        </div>
                                    ))}
                                    {(formData.notificationRules || []).length === 0 && (
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Jika kosong, sistem memakai fallback: Monitoring Utama untuk internal always-on saja.</p>
                                    )}
                                </div>
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
                        <>
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
                            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FeatureItem
                                    title="Multi Grup Monitoring"
                                    description={`${telegramStatus?.notificationTargets?.length || 0} grup tambahan terdaftar.`}
                                    enabled={(telegramStatus?.notificationTargets?.length || 0) > 0}
                                />
                                <FeatureItem
                                    title="Routing Policy"
                                    description={`${telegramStatus?.notificationRules?.length || 0} rule aktif untuk area/kamera.`}
                                    enabled={(telegramStatus?.notificationRules?.length || 0) > 0 || telegramStatus?.monitoringConfigured}
                                />
                            </div>
                            {(telegramStatus?.notificationTargets || []).length > 0 && (
                                <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Target Grup Aktif</h3>
                                    <div className="space-y-2">
                                        {(telegramStatus.notificationTargets || []).map((target) => {
                                            const loadingKey = `target:${target.id}`;
                                            return (
                                                <div key={target.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-gray-900 dark:text-white truncate">{target.name}</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{target.chatId}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        aria-label={`Test ${target.name}`}
                                                        onClick={() => handleTestNotification('target', { targetId: target.id })}
                                                        disabled={testLoading[loadingKey]}
                                                        className="shrink-0 text-xs px-2 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition-colors disabled:opacity-60"
                                                    >
                                                        {testLoading[loadingKey] ? 'Mengirim...' : 'Test'}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
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
                    <FeatureItem title="Kamera Offline" description="Notifikasi otomatis saat kamera terputus." enabled={telegramStatus?.cameraMonitoringConfigured} />
                    <FeatureItem title="Kamera Online" description="Notifikasi saat kamera kembali terhubung." enabled={telegramStatus?.cameraMonitoringConfigured} />
                    <FeatureItem title="Kritik dan Saran" description="Notifikasi saat ada feedback baru." enabled={telegramStatus?.feedbackConfigured} />
                    <FeatureItem title="Cooldown 5 Menit" description="Mengurangi spam notifikasi berulang." enabled={telegramStatus?.enabled} />
                </div>
            </div>
        </div>
    );
}
