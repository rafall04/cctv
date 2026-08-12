/*
 * Purpose: Admin page for the provider's own promo posters — list, create, edit, delete,
 *   and read impression/click figures.
 * Caller: App.jsx route /admin/promo-banners (admin only).
 * Deps: promoBannerService, areaService, cameraService, PromoBannerForm, ConfirmDialog.
 * MainFuncs: PromoBannerManagement.
 * SideEffects: Admin CRUD against /api/promo-banners.
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
import PromoBannerForm from '../components/admin/promo/PromoBannerForm';
import ConfirmDialog from '../components/ui/ConfirmDialog';

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

function PromoRow({ promo, areaNameById, onEdit, onDelete }) {
    /*
     * "Aktif" here is the operator's switch. A banner can be switched on and still
     * not be showing — no image yet, or outside its schedule — so those states are
     * called out separately rather than hidden behind one green chip.
     */
    const today = new Date().toISOString().slice(0, 10);
    const notStarted = promo.start_date && promo.start_date > today;
    const expired = promo.end_date && promo.end_date < today;
    const live = Boolean(promo.active) && Boolean(promo.image_base) && !notStarted && !expired;

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
                            : <Chip tone="idle">{!promo.active ? 'Nonaktif' : !promo.image_base ? 'Tanpa gambar' : notStarted ? 'Belum mulai' : 'Kedaluwarsa'}</Chip>}
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
    const [pendingDelete, setPendingDelete] = useState(null);
    const { showNotification } = useNotification();

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
            const [promoResult, areaResult, cameraResult] = await Promise.all([
                getAllPromoBanners(),
                areaService.getAllAreas(),
                cameraService.getAllCameras(),
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
            return;
        }

        showNotification({
            type: 'success',
            title: editing?.id ? 'Promo diperbarui' : 'Promo dibuat',
            message: editing?.id ? '' : 'Sekarang unggah gambar posternya.',
        });

        await loadPromos();
        // Stay on the new banner so the operator can upload its poster right away —
        // the image endpoint needs an id, so a fresh banner has no image yet.
        setEditing(result.data || null);
    };

    const handleDelete = async () => {
        if (!pendingDelete) {
            return;
        }
        const result = await deletePromoBanner(pendingDelete.id);
        setPendingDelete(null);

        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menghapus', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: 'Promo dihapus' });
        if (editing?.id === pendingDelete.id) {
            setEditing(null);
        }
        await loadPromos();
    };

    return (
        <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-content">Promo Pemasangan</h1>
                    <p className="mt-1 text-sm text-content-muted">
                        Poster promosi milik provider sendiri, tampil di bawah video live dan halaman publik lain.
                        Terpisah dari Sponsor dan dari Iklan — tetap tayang walau iklan dimatikan.
                    </p>
                </div>
                {!editing && (
                    <button
                        type="button"
                        onClick={() => setEditing({})}
                        className="rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    >
                        Tambah promo
                    </button>
                )}
            </header>

            {editing && (
                <section className="rounded-card border border-edge bg-surface p-4 shadow-e1">
                    <h2 className="mb-4 text-base font-semibold text-content">
                        {editing.id ? `Ubah: ${editing.title}` : 'Promo baru'}
                    </h2>
                    <PromoBannerForm
                        promo={editing.id ? editing : null}
                        areas={areas}
                        cameras={cameras}
                        saving={saving}
                        onSubmit={handleSubmit}
                        onCancel={() => setEditing(null)}
                    />
                </section>
            )}

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
                        onDelete={setPendingDelete}
                    />
                ))}
            </section>

            {pendingDelete && (
                <ConfirmDialog
                    title="Hapus promo?"
                    message={`"${pendingDelete.title}" beserta gambar dan statistiknya akan dihapus permanen.`}
                    confirmLabel="Hapus"
                    cancelLabel="Batal"
                    tone="danger"
                    onConfirm={handleDelete}
                    onCancel={() => setPendingDelete(null)}
                />
            )}
        </div>
    );
}
