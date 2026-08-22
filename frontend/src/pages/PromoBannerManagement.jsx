/*
 * Purpose: Admin page for the provider's own promo posters — list, create, edit, delete,
 *   and read impression/click figures.
 * Caller: App.jsx route /admin/promo-banners (admin only).
 * Deps: promoBannerService, areaService, cameraService, PromoBannerForm, components/ui (Button,
 *   Modal, PageHeader), ConfirmContext.useConfirm.
 * MainFuncs: PromoBannerManagement.
 * SideEffects: Admin CRUD against /api/promo-banners.
 *
 * THE EDITOR IS A ui/Modal, AND IT IS dismissible={false}
 * -------------------------------------------------------
 * It used to be an inline <section> shoved above the list, which pushed the rows off screen the
 * moment "Tambah promo" was pressed. As a dialog it matches every other admin form and inherits the
 * focus trap, Escape, scroll lock and pinned footer instead of re-deciding each one here.
 *
 * `dismissible={false}` is deliberately the OPPOSITE of ui/Modal's default. This form is ~24 fields
 * plus a poster upload; a backdrop tap beside it would silently throw all of that away, and there
 * is no draft anywhere to recover it from. Closing is Batal, and only Batal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    getAllPromoBanners,
    createPromoBanner,
    updatePromoBanner,
    deletePromoBanner,
} from '../services/promoBannerService';
import { areaService } from '../services/areaService';
import { cameraService } from '../services/cameraService';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { Button, Modal, PageHeader } from '../components/ui';
import PromoBannerForm, { PROMO_FORM_ID } from '../components/admin/promo/PromoBannerForm';

const PLACEMENT_LABELS = {
    popup: 'Bawah video live',
    area: 'Halaman area',
    landing: 'Halaman depan',
    playback: 'Halaman rekaman',
};

const TARGET_LABELS = {
    all: 'Semua kamera',
    area: 'Area terpilih',
    camera: 'Kamera terpilih',
};

function Chip({ children, tone = 'neutral' }) {
    const tones = {
        neutral: 'border-edge bg-surface-sunken text-content-muted',
        live: 'border-status-live/30 bg-status-live/10 text-status-live',
        idle: 'border-edge bg-surface-sunken text-content-subtle',
    };
    return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
            {children}
        </span>
    );
}

const STATE_LABELS = {
    inactive: 'Nonaktif',
    no_image: 'Tanpa gambar',
    not_started: 'Belum mulai',
    expired: 'Kedaluwarsa',
};

function PromoRow({ promo, areaNameById, onEdit, onDelete }) {
    /*
     * "Aktif" is only the operator's switch. A banner can be switched on and still
     * not be showing — no image yet, or outside its schedule — so those states are
     * named separately rather than hidden behind one green chip.
     *
     * The state comes from the SERVER, which evaluates the schedule in the app's
     * local timezone. Recomputing it here from the browser clock disagreed with the
     * backend for the first 7 hours of every WIB day.
     */
    const live = Boolean(promo.is_live);

    const targetSummary = promo.target_mode === 'area'
        ? (promo.area_ids || []).map((id) => areaNameById.get(id) || `#${id}`).join(', ') || 'belum dipilih'
        : promo.target_mode === 'camera'
            ? `${(promo.camera_ids || []).length} kamera`
            : 'semua kamera';

    return (
        <div className="rounded-card border border-edge bg-surface p-4 shadow-e1">
            <div className="flex flex-col gap-4 sm:flex-row">
                {promo.image_base ? (
                    <img
                        src={`/api/promo-media/${promo.image_base}-640.webp`}
                        alt=""
                        className="h-24 w-full shrink-0 rounded-card border border-edge object-cover sm:w-40"
                    />
                ) : (
                    <div className="flex h-24 w-full shrink-0 items-center justify-center rounded-card border border-dashed border-edge bg-surface-sunken text-xs text-content-subtle sm:w-40">
                        Tanpa gambar
                    </div>
                )}

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 truncate text-base font-semibold text-content">{promo.title}</h3>
                        {live
                            ? <Chip tone="live">Tayang</Chip>
                            : <Chip tone="idle">{STATE_LABELS[promo.schedule_state] || 'Tidak tayang'}</Chip>}
                    </div>

                    <p className="mt-1 text-sm text-content-muted">
                        {TARGET_LABELS[promo.target_mode]} — {targetSummary}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {(promo.placements || []).map((placement) => (
                            <Chip key={placement}>{PLACEMENT_LABELS[placement] || placement}</Chip>
                        ))}
                    </div>

                    <p className="mt-2 font-mono text-xs tabular-nums text-content-subtle">
                        {promo.total_impressions ?? 0} tayang · {promo.total_clicks ?? 0} klik
                        {promo.total_impressions > 0 && (
                            <> · {((promo.total_clicks / promo.total_impressions) * 100).toFixed(1)}%</>
                        )}
                        {(promo.start_date || promo.end_date) && (
                            <> · {promo.start_date || '…'} → {promo.end_date || '…'}</>
                        )}
                    </p>
                </div>

                <div className="flex shrink-0 gap-2 sm:flex-col">
                    <button
                        type="button"
                        onClick={() => onEdit(promo)}
                        className="rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:border-edge-strong hover:text-content"
                    >
                        Ubah
                    </button>
                    <button
                        type="button"
                        onClick={() => onDelete(promo)}
                        className="rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-status-fault transition-colors hover:border-status-fault/40"
                    >
                        Hapus
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function PromoBannerManagement() {
    const [promos, setPromos] = useState([]);
    const [areas, setAreas] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(null);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const loadPromos = useCallback(async () => {
        const result = await getAllPromoBanners();
        if (result.success) {
            setPromos(result.data || []);
        } else {
            showNotification({ type: 'error', title: 'Gagal memuat promo', message: result.message });
        }
    }, [showNotification]);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            /*
             * Each request is caught individually. cameraService.getAllCameras THROWS
             * on failure instead of returning { success: false }, so a bare Promise.all
             * would reject and leave the whole page stuck on "Memuat…" — including the
             * promo list, which does not depend on cameras at all.
             */
            const settle = (promise) => promise.then(
                (value) => value,
                (error) => ({ success: false, message: error?.message || 'Gagal memuat' })
            );
            const [promoResult, areaResult, cameraResult] = await Promise.all([
                settle(getAllPromoBanners()),
                settle(areaService.getAllAreas()),
                settle(cameraService.getAllCameras()),
            ]);
            if (cancelled) {
                return;
            }
            if (promoResult.success) {
                setPromos(promoResult.data || []);
            } else {
                showNotification({ type: 'error', title: 'Gagal memuat promo', message: promoResult.message });
            }
            if (areaResult.success) {
                setAreas(areaResult.data || []);
            }
            if (cameraResult.success) {
                setCameras(cameraResult.data || []);
            }
            setLoading(false);
        };

        load();
        return () => { cancelled = true; };
    }, [showNotification]);

    const areaNameById = useMemo(
        () => new Map(areas.map((area) => [area.id, area.name])),
        [areas]
    );

    const handleSubmit = async (payload) => {
        setSaving(true);
        const result = editing?.id
            ? await updatePromoBanner(editing.id, payload)
            : await createPromoBanner(payload);
        setSaving(false);

        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menyimpan', message: result.message });
            return null;
        }

        showNotification({
            type: 'success',
            title: editing?.id ? 'Promo diperbarui' : 'Promo dibuat',
        });

        await loadPromos();
        // Stay on the saved banner so the operator keeps editing it — and so the form
        // can attach a poster that was picked before this promo had an id.
        setEditing(result.data || null);
        // Returned so the form knows the new id and can flush a pending upload.
        return result.data || null;
    };

    /*
     * The app-wide ConfirmProvider owns the dialog, so the page keeps no `pendingDelete` row in
     * state just to feed one it mounted itself — `await confirm(...)` reads top-to-bottom, like the
     * 16 other call sites.
     */
    const handleDelete = async (promo) => {
        const confirmed = await confirm({
            title: 'Hapus promo?',
            message: `"${promo.title}" beserta gambar dan statistiknya akan dihapus permanen.`,
            confirmLabel: 'Hapus',
            cancelLabel: 'Batal',
            tone: 'danger',
        });
        if (!confirmed) {
            return;
        }

        const result = await deletePromoBanner(promo.id);

        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menghapus', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: 'Promo dihapus' });
        if (editing?.id === promo.id) {
            setEditing(null);
        }
        await loadPromos();
    };

    return (
        <div className="space-y-6">
            {/*
              * The action is no longer hidden while the editor is open: the editor is a dialog now,
              * so it covers the page, traps focus and locks scroll. Hiding the button as well only
              * made the header jump every time the dialog opened and closed.
              */}
            <PageHeader
                title="Promo Pemasangan"
                description="Poster promosi milik provider sendiri, tampil di bawah video live dan halaman publik lain. Terpisah dari Sponsor dan dari Iklan — tetap tayang walau iklan dimatikan."
                actions={<Button variant="primary" onClick={() => setEditing({})}>Tambah promo</Button>}
            />

            <section className="space-y-3">
                {loading && <p className="text-sm text-content-muted">Memuat…</p>}

                {!loading && promos.length === 0 && (
                    <div className="rounded-card border border-dashed border-edge bg-surface-sunken p-8 text-center">
                        <p className="text-sm text-content-muted">Belum ada promo.</p>
                        <p className="mt-1 text-xs text-content-subtle">
                            Buat satu, unggah posternya, lalu pilih area atau kamera tempatnya tampil.
                        </p>
                    </div>
                )}

                {promos.map((promo) => (
                    <PromoRow
                        key={promo.id}
                        promo={promo}
                        areaNameById={areaNameById}
                        onEdit={setEditing}
                        onDelete={handleDelete}
                    />
                ))}
            </section>

            {editing && (
                <Modal
                    title={editing.id ? `Ubah: ${editing.title}` : 'Promo baru'}
                    size="xl"
                    // See the header: NOT the ui/Modal default, and that is the whole point.
                    dismissible={false}
                    onClose={() => setEditing(null)}
                    footer={(
                        <>
                            <Button onClick={() => setEditing(null)} disabled={saving}>Batal</Button>
                            <Button type="submit" form={PROMO_FORM_ID} variant="primary" loading={saving}>
                                {saving ? 'Menyimpan…' : 'Simpan'}
                            </Button>
                        </>
                    )}
                >
                    <PromoBannerForm
                        promo={editing.id ? editing : null}
                        areas={areas}
                        cameras={cameras}
                        onSubmit={handleSubmit}
                        onUploaded={loadPromos}
                    />
                </Modal>
            )}
        </div>
    );
}
