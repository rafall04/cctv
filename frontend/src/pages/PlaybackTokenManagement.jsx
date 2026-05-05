/*
 * Purpose: Admin page for creating, sharing, listing, and revoking scoped playback tokens.
 * Caller: App.jsx protected admin route.
 * Deps: React hooks, cameraService, playbackTokenService, NotificationContext.
 * MainFuncs: PlaybackTokenManagement.
 * SideEffects: Calls admin playback token APIs and copies/share text through browser APIs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cameraService } from '../services/cameraService';
import playbackTokenService from '../services/playbackTokenService.js';
import { useNotification } from '../contexts/NotificationContext';

const DEFAULT_TEMPLATE = `Halo, berikut token akses playback CCTV RAF NET.

Token: {{token}}
Link: {{playback_url}}
Berlaku: {{expires_at}}
Akses: {{camera_scope}}`;

const PRESETS = [
    { value: 'trial_1d', label: 'Trial 1 Hari' },
    { value: 'trial_3d', label: 'Trial 3 Hari' },
    { value: 'client_30d', label: 'Client 30 Hari' },
    { value: 'lifetime', label: 'Lifetime' },
    { value: 'custom', label: 'Custom' },
];

function normalizeCameraRows(response) {
    const rows = response?.data?.cameras || response?.data || [];
    return Array.isArray(rows) ? rows : [];
}

function formatDate(value) {
    if (!value) {
        return 'Selamanya';
    }

    return new Date(value).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function PlaybackTokenManagement() {
    const { success: showSuccess, error: showError } = useNotification();
    const [tokens, setTokens] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [createdShare, setCreatedShare] = useState(null);
    const [form, setForm] = useState({
        label: '',
        preset: 'trial_3d',
        scope_type: 'all',
        camera_ids: [],
        playback_window_hours: '',
        expires_at: '',
        share_template: DEFAULT_TEMPLATE,
    });

    const selectedCameraIds = useMemo(
        () => new Set(form.camera_ids.map((id) => Number.parseInt(id, 10))),
        [form.camera_ids]
    );

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [tokenResponse, cameraResponse] = await Promise.all([
                playbackTokenService.listTokens(),
                cameraService.getAllCameras(),
            ]);
            setTokens(Array.isArray(tokenResponse?.data) ? tokenResponse.data : []);
            setCameras(normalizeCameraRows(cameraResponse));
        } catch (error) {
            showError('Gagal memuat token playback', error?.response?.data?.message || error.message);
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const updateForm = (key, value) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const toggleCamera = (cameraId) => {
        setForm((current) => {
            const next = new Set(current.camera_ids);
            if (next.has(cameraId)) {
                next.delete(cameraId);
            } else {
                next.add(cameraId);
            }
            return { ...current, camera_ids: [...next] };
        });
    };

    const handleCreate = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            const payload = {
                ...form,
                playback_window_hours: form.playback_window_hours || null,
                expires_at: form.expires_at || null,
            };
            const response = await playbackTokenService.createToken(payload);
            setCreatedShare({
                token: response.token,
                shareText: response.share_text,
            });
            showSuccess('Token playback dibuat', 'Token hanya ditampilkan satu kali.');
            setForm((current) => ({ ...current, label: '', camera_ids: [] }));
            await loadData();
        } catch (error) {
            showError('Gagal membuat token', error?.response?.data?.message || error.message);
        } finally {
            setSaving(false);
        }
    };

    const handleCopy = async (text) => {
        await navigator.clipboard.writeText(text);
        showSuccess('Disalin', 'Teks share token sudah disalin.');
    };

    const handleNativeShare = async () => {
        if (!createdShare?.shareText) {
            return;
        }

        if (navigator.share) {
            await navigator.share({ text: createdShare.shareText });
            return;
        }

        await handleCopy(createdShare.shareText);
    };

    const handleRevoke = async (tokenId) => {
        try {
            await playbackTokenService.revokeToken(tokenId);
            showSuccess('Token dicabut', 'Token tidak bisa digunakan lagi.');
            await loadData();
        } catch (error) {
            showError('Gagal mencabut token', error?.response?.data?.message || error.message);
        }
    };

    const whatsappHref = createdShare?.shareText
        ? `https://wa.me/?text=${encodeURIComponent(createdShare.shareText)}`
        : '#';

    return (
        <div className="space-y-6 py-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Playback Tokens</h1>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    Buat token playback publik dengan scope kamera, masa berlaku, dan template share.
                </p>
            </div>

            <form onSubmit={handleCreate} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Nama Token</span>
                        <input
                            value={form.label}
                            onChange={(event) => updateForm('label', event.target.value)}
                            placeholder="Contoh: Trial Client Area Barat"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                        />
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Preset</span>
                        <select
                            value={form.preset}
                            onChange={(event) => updateForm('preset', event.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                        >
                            {PRESETS.map((preset) => (
                                <option key={preset.value} value={preset.value}>{preset.label}</option>
                            ))}
                        </select>
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Scope Kamera</span>
                        <select
                            value={form.scope_type}
                            onChange={(event) => updateForm('scope_type', event.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                        >
                            <option value="all">Semua kamera playback</option>
                            <option value="selected">Kamera tertentu</option>
                        </select>
                    </label>

                    {form.preset === 'custom' && (
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                                <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Window Jam</span>
                                <input
                                    type="number"
                                    min="1"
                                    value={form.playback_window_hours}
                                    onChange={(event) => updateForm('playback_window_hours', event.target.value)}
                                    placeholder="Kosong = full"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Expired</span>
                                <input
                                    type="datetime-local"
                                    value={form.expires_at}
                                    onChange={(event) => updateForm('expires_at', event.target.value)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                                />
                            </label>
                        </div>
                    )}
                </div>

                {form.scope_type === 'selected' && (
                    <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                        <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Pilih Kamera</div>
                        <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                            {cameras.map((camera) => (
                                <label key={camera.id} className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-gray-950">
                                    <input
                                        type="checkbox"
                                        checked={selectedCameraIds.has(camera.id)}
                                        onChange={() => toggleCamera(camera.id)}
                                    />
                                    <span className="truncate text-gray-800 dark:text-gray-200">{camera.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                <label className="mt-4 block">
                    <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Template Share</span>
                    <textarea
                        rows={6}
                        value={form.share_template}
                        onChange={(event) => updateForm('share_template', event.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                    />
                    <span className="mt-1 block text-xs text-gray-500">
                        Placeholder: {'{{token}}'}, {'{{playback_url}}'}, {'{{expires_at}}'}, {'{{label}}'}, {'{{camera_scope}}'}, {'{{playback_window}}'}
                    </span>
                </label>

                <div className="mt-4 flex justify-end">
                    <button
                        type="submit"
                        disabled={saving || (form.scope_type === 'selected' && form.camera_ids.length === 0)}
                        className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {saving ? 'Membuat...' : 'Buat Token'}
                    </button>
                </div>
            </form>

            {createdShare && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/40">
                    <div className="mb-3 text-sm font-semibold text-emerald-900 dark:text-emerald-100">Token baru dibuat</div>
                    <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-gray-800 dark:bg-gray-950 dark:text-gray-100">{createdShare.shareText}</pre>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => handleCopy(createdShare.shareText)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-gray-900">
                            Copy Teks
                        </button>
                        <button onClick={handleNativeShare} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-800 dark:bg-gray-800 dark:text-gray-100">
                            Share
                        </button>
                        <a href={whatsappHref} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                            WhatsApp
                        </a>
                    </div>
                </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Token Aktif</h2>
                    <button onClick={loadData} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                        Refresh
                    </button>
                </div>
                {loading ? (
                    <div className="py-8 text-center text-sm text-gray-500">Loading...</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                            <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-3 py-2">Nama</th>
                                    <th className="px-3 py-2">Scope</th>
                                    <th className="px-3 py-2">Expired</th>
                                    <th className="px-3 py-2">Dipakai</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {tokens.map((token) => (
                                    <tr key={token.id} className="text-gray-800 dark:text-gray-200">
                                        <td className="px-3 py-3">
                                            <div className="font-medium">{token.label}</div>
                                            <div className="text-xs text-gray-500">{token.token_prefix}...</div>
                                        </td>
                                        <td className="px-3 py-3">{token.scope_type === 'selected' ? `${token.camera_ids.length} kamera` : 'Semua'}</td>
                                        <td className="px-3 py-3">{formatDate(token.expires_at)}</td>
                                        <td className="px-3 py-3">{token.use_count || 0}x</td>
                                        <td className="px-3 py-3">
                                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${token.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                                {token.is_active ? 'Aktif' : 'Nonaktif'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-right">
                                            {token.is_active && (
                                                <button onClick={() => handleRevoke(token.id)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">
                                                    Cabut
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
