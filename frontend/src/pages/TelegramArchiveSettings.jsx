/*
 * Purpose: Admin page for the Telegram recording archive — decide which camera or which whole area
 *          is uploaded to which Telegram group, verify a group before saving, and see what the
 *          sidecar has actually sent.
 * Caller: Protected admin route /admin/telegram-archive (adminOnly).
 * Deps: React hooks, NotificationContext, ConfirmContext, telegramArchiveService,
 *       components/admin/telegramArchive/*, Skeleton.
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
import RouteForm from '../components/admin/telegramArchive/RouteForm';
import RouteList from '../components/admin/telegramArchive/RouteList';
import CameraRouting from '../components/admin/telegramArchive/CameraRouting';
import ArchiveActivity from '../components/admin/telegramArchive/ArchiveActivity';
import { card } from '../components/admin/telegramArchive/archiveUi';
import { TableSkeleton } from '../components/ui/Skeleton';

const EMPTY_DRAFT = { scope: 'camera', cameraId: '', areaId: '', chatId: '', label: '', enabled: true };

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
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
        setVerified(null);
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
            <div className="mx-auto max-w-4xl space-y-5">
                <h1 className="text-xl font-semibold text-content">Arsip Rekaman ke Telegram</h1>
                <TableSkeleton rows={5} />
            </div>
        );
    }

    if (overview && overview.available === false) {
        return (
            <div className="mx-auto max-w-4xl space-y-5">
                <h1 className="text-xl font-semibold text-content">Arsip Rekaman ke Telegram</h1>
                <div className={`${card} p-6`}>
                    <p className="text-sm leading-relaxed text-content-muted">
                        Layanan arsip (<code className="text-content">tg-archive</code>) belum terpasang di
                        server ini, jadi tidak ada yang bisa diatur dari sini.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-4xl space-y-5">
            <header>
                <h1 className="text-xl font-semibold text-content sm:text-2xl">
                    Arsip Rekaman ke Telegram
                </h1>
                <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-content-muted">
                    Menentukan rekaman kamera mana dikirim ke grup Telegram mana, setiap 10 menit.
                    Kamera yang tidak punya rute tidak dikirim sama sekali.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-subtle">
                    <span className="font-mono tabular-nums text-content-muted">
                        {routedCount}/{cameras.length}
                    </span>
                    <span>kamera perekam sedang diarsipkan</span>
                    <span aria-hidden="true">·</span>
                    <span>perubahan berlaku ±1 menit, tanpa menyalakan ulang apa pun</span>
                </div>
            </header>

            <RouteForm
                draft={draft}
                setField={setField}
                cameras={cameras}
                areas={areas}
                editing={Boolean(editingId)}
                onSubmit={handleSubmit}
                onCancel={handleCancelEdit}
                onVerify={handleVerify}
                verifying={verifying}
                verified={verified}
                saving={saving}
            />

            <RouteList
                routes={routes}
                busyId={busyId}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
            />

            <CameraRouting cameras={cameras} routedCount={routedCount} />

            <ArchiveActivity activity={activity} />
        </div>
    );
}

export default TelegramArchiveSettings;
