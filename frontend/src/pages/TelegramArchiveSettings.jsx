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
import RouteForm, { ROUTE_FORM_ID } from '../components/admin/telegramArchive/RouteForm';
import RouteList from '../components/admin/telegramArchive/RouteList';
import CameraRouting from '../components/admin/telegramArchive/CameraRouting';
import ArchiveActivity from '../components/admin/telegramArchive/ArchiveActivity';
import { card } from '../components/admin/telegramArchive/archiveUi';
import { Button, Modal, PageHeader } from '../components/ui';
import { TableSkeleton } from '../components/ui/Skeleton';

const EMPTY_DRAFT = { scope: 'camera', cameraId: '', areaId: '', chatId: '', label: '', enabled: true };

// One spelling of the title for all three of this page's states — loading, unavailable, and loaded.
const JUDUL = 'Arsip Rekaman ke Telegram';

export function TelegramArchiveSettings() {
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const [overview, setOverview] = useState(null);
    const [activity, setActivity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState(EMPTY_DRAFT);
    const [editingId, setEditingId] = useState(null);
    /*
     * ONE dialog for both "tambah" and "ubah", not two. There is one draft, one submit handler and
     * one set of fields; `editingId` is the only difference, and it already decides create-vs-update
     * inside handleSubmit. A second dialog would be the same form twice, free to drift apart —
     * exactly how the "add" and "edit" paths of a form start disagreeing about validation.
     */
    const [formOpen, setFormOpen] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verified, setVerified] = useState(null);
    const [saving, setSaving] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [manualChat, setManualChat] = useState(false);

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
    const groups = overview?.groups ?? [];
    const routedCount = cameras.filter((camera) => camera.targets.length > 0).length;

    // Picking a known group already tells us the title and whether the bot may post, so the
    // manual "check this id" step exists only for the fallback path.
    const handlePickGroup = (chatId) => {
        const group = groups.find((g) => g.chatId === chatId);
        setDraft((prev) => ({
            ...prev,
            chatId,
            label: prev.label || group?.title || '',
        }));
        setVerified(group ? { title: group.title, canSendDocuments: group.canSend !== false } : null);
    };

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
            setFormOpen(false);
            await load();
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal menyimpan rute', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleAdd = () => {
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
        setVerified(null);
        setManualChat(false);
        setFormOpen(true);
    };

    const handleEdit = (route) => {
        setEditingId(route.id);
        setVerified(null);
        // A route pointing at a group the bot has since left (or was configured before discovery
        // existed) has no matching option — fall back to the text field so the id stays visible
        // instead of silently resetting to "— pilih grup —".
        setManualChat(!groups.some((group) => group.chatId === route.chatId));
        setDraft({
            scope: route.scope,
            cameraId: route.cameraId ?? '',
            areaId: route.areaId ?? '',
            chatId: route.chatId ?? '',
            label: route.label ?? '',
            enabled: route.enabled !== false,
        });
        // No scrollTo any more: the form used to sit above the list, so editing a route near the
        // bottom moved the fields off-screen. A dialog comes to the operator instead.
        setFormOpen(true);
    };

    const handleCancelEdit = () => {
        setFormOpen(false);
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
        setVerified(null);
        setManualChat(false);
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
            confirmLabel: 'Hapus',
            tone: 'danger',
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
            <div className="space-y-5">
                <PageHeader title={JUDUL} />
                <TableSkeleton rows={5} />
            </div>
        );
    }

    if (overview && overview.available === false) {
        return (
            <div className="space-y-5">
                <PageHeader title={JUDUL} />
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
        <div className="space-y-5">
            <PageHeader
                title={JUDUL}
                description="Menentukan rekaman kamera mana dikirim ke grup Telegram mana, setiap 10 menit. Kamera yang tidak punya rute tidak dikirim sama sekali."
                meta={(
                    <>
                        <span className="font-mono tabular-nums text-xs text-content-muted">
                            {routedCount}/{cameras.length}
                        </span>
                        <span className="text-xs text-content-subtle">kamera perekam sedang diarsipkan</span>
                        {/* Decorative separator: it reads as "middle dot" otherwise. */}
                        <span aria-hidden="true" className="text-xs text-content-subtle">·</span>
                        <span className="text-xs text-content-subtle">perubahan berlaku ±1 menit, tanpa menyalakan ulang apa pun</span>
                    </>
                )}
                actions={<Button variant="primary" onClick={handleAdd}>+ Tambah rute</Button>}
            />

            <RouteList
                routes={routes}
                cameras={cameras}
                areas={areas}
                busyId={busyId}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
            />

            <CameraRouting cameras={cameras} routedCount={routedCount} />

            <ArchiveActivity activity={activity} />

            {formOpen && (
                <Modal
                    title={editingId ? 'Ubah rute' : 'Tambah rute baru'}
                    description="Rekaman kamera yang dipilih dikirim ke grup ini setiap 10 menit."
                    size="lg"
                    onClose={handleCancelEdit}
                    /* dismissible={false}: the group id is often pasted from another app and then
                       verified against Telegram — losing that to a mis-tap on the scrim would mean
                       doing the check again. */
                    dismissible={false}
                    footer={(
                        <>
                            <Button onClick={handleCancelEdit} disabled={saving}>Batal</Button>
                            <Button type="submit" form={ROUTE_FORM_ID} variant="primary" loading={saving}>
                                {saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Tambah rute'}
                            </Button>
                        </>
                    )}
                >
                    <RouteForm
                        draft={draft}
                        setField={setField}
                        cameras={cameras}
                        areas={areas}
                        groups={groups}
                        manual={manualChat}
                        onToggleManual={() => { setManualChat((v) => !v); setVerified(null); }}
                        onPickGroup={handlePickGroup}
                        onSubmit={handleSubmit}
                        onVerify={handleVerify}
                        verifying={verifying}
                        verified={verified}
                    />
                </Modal>
            )}
        </div>
    );
}

export default TelegramArchiveSettings;
