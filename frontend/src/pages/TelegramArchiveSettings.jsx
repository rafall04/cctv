/*
 * Purpose: Admin page for the Telegram recording archive — decide which camera or which whole area
 *          is uploaded to which Telegram group, verify a group before saving, and see what the
 *          sidecar has actually sent.
 * Caller: Protected admin route /admin/telegram-archive (adminOnly).
 * Deps: React hooks, NotificationContext, ConfirmContext, telegramArchiveService, Skeleton.
 * MainFuncs: TelegramArchiveSettings.
 * SideEffects: Calls /api/admin/telegram-archive/*.
 *
 * Routes reach the uploader within ~1 minute because it re-reads routes.json on change — no restart.
 * A camera with no route is never uploaded, so the route list doubles as the on/off switch.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import telegramArchiveService from '../services/telegramArchiveService';
import { TableSkeleton } from '../components/ui/Skeleton';

const inputClass =
    'w-full bg-surface-sunken border border-edge rounded-control px-3 py-2 text-content text-sm ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus:border-edge-strong';
const labelClass = 'block text-xs font-medium text-content-muted mb-1.5';
const hintClass = 'mt-1 text-[11px] text-content-subtle';
const btnGhost =
    'rounded-control border border-edge px-3 py-1.5 text-xs text-content-muted hover:border-edge-strong ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50';
const btnPrimary =
    'rounded-control bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-500 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50';

const EMPTY_DRAFT = { scope: 'camera', cameraId: '', areaId: '', chatId: '', label: '', enabled: true };

function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    const mb = bytes / 1048576;
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

export function TelegramArchiveSettings() {
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const [overview, setOverview] = useState(null);
    const [activity, setActivity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState(EMPTY_DRAFT);
    const [editingId, setEditingId] = useState(null);
    const [verifying, setVerifying] = useState(false);
    const [verified, setVerified] = useState(null);
    const [saving, setSaving] = useState(false);
    const [busyId, setBusyId] = useState(null);

    const load = useCallback(async () => {
        try {
            const [ov, act] = await Promise.all([
                telegramArchiveService.getOverview(),
                telegramArchiveService.getActivity().catch(() => ({ data: null })),
            ]);
            setOverview(ov?.data ?? null);
            setActivity(act?.data ?? null);
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal memuat pengaturan arsip', 'error');
        } finally {
            setLoading(false);
        }
    }, [showNotification]);

    useEffect(() => { load(); }, [load]);

    // Verification is tied to the exact chat id it was run against — editing the field must
    // invalidate it, otherwise a stale green tick would vouch for a number nobody checked.
    const setField = (key, value) => {
        setDraft((prev) => ({ ...prev, [key]: value }));
        if (key === 'chatId') setVerified(null);
    };

    const cameras = overview?.cameras ?? [];
    const areas = overview?.areas ?? [];
    const routes = overview?.routes ?? [];

    // Plain filter, not useMemo: the fleet is a handful of cameras, and memoising a value derived
    // from a fresh array literal each render buys nothing.
    const routedCount = cameras.filter((camera) => camera.targets.length > 0).length;

    const handleVerify = async () => {
        if (!draft.chatId.trim()) {
            showNotification('Isi ID grup dulu', 'warning');
            return;
        }
        setVerifying(true);
        try {
            const res = await telegramArchiveService.verifyChat(draft.chatId.trim());
            setVerified(res.data);
            showNotification(`Grup ditemukan: ${res.data.title}`, 'success');
        } catch (error) {
            setVerified(null);
            showNotification(error.response?.data?.message || 'Grup tidak bisa diperiksa', 'error');
        } finally {
            setVerifying(false);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            const payload = {
                scope: draft.scope,
                chatId: draft.chatId.trim(),
                label: draft.label.trim(),
                enabled: draft.enabled,
            };
            if (draft.scope === 'camera') payload.cameraId = Number(draft.cameraId);
            if (draft.scope === 'area') payload.areaId = Number(draft.areaId);

            const res = editingId
                ? await telegramArchiveService.updateRoute(editingId, payload)
                : await telegramArchiveService.createRoute(payload);
            showNotification(res.message || 'Tersimpan', 'success');
            setDraft(EMPTY_DRAFT);
            setEditingId(null);
            setVerified(null);
            await load();
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal menyimpan rute', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleEdit = (route) => {
        setEditingId(route.id);
        setVerified(null);
        setDraft({
            scope: route.scope,
            cameraId: route.cameraId ?? '',
            areaId: route.areaId ?? '',
            chatId: route.chatId ?? '',
            label: route.label ?? '',
            enabled: route.enabled !== false,
        });
    };

    const handleToggle = async (route) => {
        setBusyId(route.id);
        try {
            await telegramArchiveService.updateRoute(route.id, {
                scope: route.scope,
                chatId: route.chatId,
                cameraId: route.cameraId,
                areaId: route.areaId,
                label: route.label || '',
                enabled: route.enabled === false,
            });
            await load();
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal mengubah status', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (route) => {
        const ok = await confirm({
            title: 'Hapus rute ini?',
            message: `Rekaman untuk "${route.label || route.id}" berhenti dikirim ke Telegram. `
                + 'File yang sudah terkirim tidak ikut terhapus.',
            confirmText: 'Hapus',
            variant: 'danger',
        });
        if (!ok) return;
        setBusyId(route.id);
        try {
            const res = await telegramArchiveService.deleteRoute(route.id);
            showNotification(res.message || 'Rute dihapus', 'success');
            await load();
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal menghapus rute', 'error');
        } finally {
            setBusyId(null);
        }
    };

    if (loading) {
        return (
            <div className="space-y-4">
                <h1 className="text-xl font-semibold text-content">Arsip Rekaman ke Telegram</h1>
                <TableSkeleton rows={5} />
            </div>
        );
    }

    if (overview && overview.available === false) {
        return (
            <div className="space-y-4">
                <h1 className="text-xl font-semibold text-content">Arsip Rekaman ke Telegram</h1>
                <div className="rounded-card border border-edge bg-surface-raised p-6">
                    <p className="text-sm text-content-muted">
                        Layanan arsip (<code className="text-content">tg-archive</code>) belum terpasang di server ini,
                        jadi tidak ada yang bisa diatur dari sini.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-xl font-semibold text-content">Arsip Rekaman ke Telegram</h1>
                <p className="mt-1 text-sm text-content-muted">
                    Menentukan rekaman kamera mana dikirim ke grup Telegram mana, setiap 10 menit.
                    Kamera yang tidak punya rute tidak dikirim sama sekali.
                </p>
                <p className={hintClass}>
                    {routedCount} dari {cameras.length} kamera perekam sedang diarsipkan.
                    Perubahan berlaku dalam ±1 menit tanpa menyalakan ulang apa pun.
                </p>
            </header>

            {/* ---------------------------------------------------------------- form */}
            <section className="rounded-card border border-edge bg-surface-raised p-5 shadow-e1">
                <h2 className="mb-4 text-sm font-semibold text-content">
                    {editingId ? 'Ubah rute' : 'Tambah rute baru'}
                </h2>
                <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
                    <div>
                        <label className={labelClass} htmlFor="tga-scope">Cakupan</label>
                        <select
                            id="tga-scope"
                            className={inputClass}
                            value={draft.scope}
                            onChange={(e) => setField('scope', e.target.value)}
                        >
                            <option value="camera">Satu kamera</option>
                            <option value="area">Satu area (semua kameranya)</option>
                            <option value="all">Semua kamera</option>
                        </select>
                        <p className={hintClass}>
                            Kalau satu kamera cocok ke dua rute, rute kamera menang dan grup lain hanya
                            menerima salinan — tidak menambah beban internet.
                        </p>
                    </div>

                    {draft.scope === 'camera' && (
                        <div>
                            <label className={labelClass} htmlFor="tga-camera">Kamera</label>
                            <select
                                id="tga-camera"
                                className={inputClass}
                                value={draft.cameraId}
                                onChange={(e) => setField('cameraId', e.target.value)}
                                required
                            >
                                <option value="">— pilih kamera —</option>
                                {cameras.map((camera) => (
                                    <option key={camera.id} value={camera.id}>
                                        {camera.name} ({camera.areaName || 'tanpa area'})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {draft.scope === 'area' && (
                        <div>
                            <label className={labelClass} htmlFor="tga-area">Area</label>
                            <select
                                id="tga-area"
                                className={inputClass}
                                value={draft.areaId}
                                onChange={(e) => setField('areaId', e.target.value)}
                                required
                            >
                                <option value="">— pilih area —</option>
                                {areas.map((area) => (
                                    <option key={area.id} value={area.id}>{area.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className={labelClass} htmlFor="tga-chat">ID grup Telegram</label>
                        <div className="flex gap-2">
                            <input
                                id="tga-chat"
                                className={inputClass}
                                value={draft.chatId}
                                onChange={(e) => setField('chatId', e.target.value)}
                                placeholder="-5510674082"
                                required
                            />
                            <button
                                type="button"
                                className={btnGhost}
                                onClick={handleVerify}
                                disabled={verifying}
                            >
                                {verifying ? 'Memeriksa…' : 'Periksa'}
                            </button>
                        </div>
                        {verified ? (
                            <p className={`mt-1 text-[11px] ${verified.canSendDocuments ? 'text-status-ok' : 'text-status-warn'}`}>
                                {verified.canSendDocuments
                                    ? `✓ ${verified.title} — bot bisa mengirim file ke sini`
                                    : `⚠ ${verified.title} — bot TIDAK diizinkan mengirim file di grup ini`}
                            </p>
                        ) : (
                            <p className={hintClass}>
                                Tambahkan bot ke grup, lalu tekan Periksa untuk memastikan ID-nya benar
                                sebelum disimpan.
                            </p>
                        )}
                    </div>

                    <div>
                        <label className={labelClass} htmlFor="tga-label">Nama rute</label>
                        <input
                            id="tga-label"
                            className={inputClass}
                            value={draft.label}
                            onChange={(e) => setField('label', e.target.value)}
                            placeholder="Arsip Selatan AHASS"
                            maxLength={80}
                        />
                        <p className={hintClass}>Hanya untuk memudahkan Anda mengenalinya di daftar.</p>
                    </div>

                    <div className="flex items-center gap-2 md:col-span-2">
                        <input
                            id="tga-enabled"
                            type="checkbox"
                            className="h-4 w-4 rounded border-edge bg-surface-sunken
                                focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            checked={draft.enabled}
                            onChange={(e) => setField('enabled', e.target.checked)}
                        />
                        <label htmlFor="tga-enabled" className="text-sm text-content-muted">Aktif</label>
                    </div>

                    <div className="flex gap-2 md:col-span-2">
                        <button type="submit" className={btnPrimary} disabled={saving}>
                            {saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Tambah rute'}
                        </button>
                        {editingId && (
                            <button
                                type="button"
                                className={btnGhost}
                                onClick={() => { setEditingId(null); setDraft(EMPTY_DRAFT); setVerified(null); }}
                            >
                                Batal
                            </button>
                        )}
                    </div>
                </form>
            </section>

            {/* ---------------------------------------------------------------- routes */}
            <section className="rounded-card border border-edge bg-surface-raised shadow-e1">
                <h2 className="border-b border-edge px-5 py-3 text-sm font-semibold text-content">
                    Rute aktif ({routes.length})
                </h2>
                {routes.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-content-muted">
                        Belum ada rute. Tidak ada rekaman yang dikirim ke Telegram.
                    </p>
                ) : (
                    <ul className="divide-y divide-edge">
                        {routes.map((route) => (
                            <li key={route.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                                <span
                                    className={`h-2 w-2 shrink-0 rounded-full ${route.enabled === false ? 'bg-content-subtle' : 'bg-status-ok'}`}
                                    aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm text-content">{route.label || route.id}</p>
                                    <p className="truncate text-[11px] text-content-subtle">
                                        {route.scope === 'camera' && `Kamera ${route.cameraId}`}
                                        {route.scope === 'area' && `Area ${route.areaId}`}
                                        {route.scope === 'all' && 'Semua kamera'}
                                        {' → '}
                                        <span className="font-mono">{route.chatId}</span>
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className={btnGhost}
                                    onClick={() => handleToggle(route)}
                                    disabled={busyId === route.id}
                                >
                                    {route.enabled === false ? 'Aktifkan' : 'Nonaktifkan'}
                                </button>
                                <button type="button" className={btnGhost} onClick={() => handleEdit(route)}>
                                    Ubah
                                </button>
                                <button
                                    type="button"
                                    className={`${btnGhost} hover:text-status-fault`}
                                    onClick={() => handleDelete(route)}
                                    disabled={busyId === route.id}
                                >
                                    Hapus
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* ------------------------------------------------------------- resolved */}
            <section className="rounded-card border border-edge bg-surface-raised shadow-e1">
                <h2 className="border-b border-edge px-5 py-3 text-sm font-semibold text-content">
                    Hasil akhir per kamera
                </h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wide text-content-subtle">
                                <th className="px-5 py-2 font-medium">Kamera</th>
                                <th className="px-5 py-2 font-medium">Area</th>
                                <th className="px-5 py-2 font-medium">Dikirim ke</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-edge">
                            {cameras.map((camera) => (
                                <tr key={camera.id}>
                                    <td className="px-5 py-2 text-content">{camera.name}</td>
                                    <td className="px-5 py-2 text-content-muted">{camera.areaName || '-'}</td>
                                    <td className="px-5 py-2">
                                        {camera.targets.length === 0 ? (
                                            <span className="text-content-subtle">tidak dikirim</span>
                                        ) : (
                                            <span className="text-content-muted">
                                                {camera.targets.map((target) => (
                                                    <span key={target.chatId} className="mr-2 inline-block">
                                                        {target.label}
                                                        {target.mode === 'copy' && (
                                                            <span className="ml-1 text-[10px] text-content-subtle">
                                                                (salinan)
                                                            </span>
                                                        )}
                                                    </span>
                                                ))}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ------------------------------------------------------------- activity */}
            {activity?.available && (
                <section className="rounded-card border border-edge bg-surface-raised shadow-e1">
                    <h2 className="border-b border-edge px-5 py-3 text-sm font-semibold text-content">
                        Aktivitas pengiriman
                    </h2>
                    <div className="flex flex-wrap gap-4 px-5 py-3">
                        {activity.totals.map((total) => (
                            <div key={total.status}>
                                <p className="font-mono text-lg text-content">{total.files}</p>
                                <p className="text-[11px] text-content-subtle">
                                    {total.status} · {formatBytes(total.bytes)}
                                </p>
                            </div>
                        ))}
                    </div>
                    <ul className="divide-y divide-edge border-t border-edge">
                        {activity.recent.map((item) => (
                            <li key={item.segmentId} className="flex items-center gap-3 px-5 py-2 text-[11px]">
                                <span className="font-mono text-content-muted">cam{item.cameraId}</span>
                                <span className="flex-1 truncate font-mono text-content-subtle">{item.filename}</span>
                                <span className="text-content-subtle">{formatBytes(item.fileSize)}</span>
                                <span className={item.status === 'ok' ? 'text-status-ok' : 'text-content-subtle'}>
                                    {item.status}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

export default TelegramArchiveSettings;
