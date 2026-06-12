/*
 * Purpose: Customer "Kamera Saya" page — grid of owned cameras with billing badge, a tokened
 *          live player modal, and self-service add/edit/delete bounded by the account plan.
 * Caller: App.jsx /my route inside CustomerLayout.
 * Deps: customerService, CustomerLivePlayer, CameraFormModal, formatRupiah.
 * MainFuncs: MyCameras.
 * SideEffects: Fetches owned cameras + plan state; camera mutations via customerService.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import customerService from '../../services/customerService';
import CustomerLivePlayer from '../../components/customer/CustomerLivePlayer';
import CameraFormModal from '../../components/customer/CameraFormModal';
import AreaManagerModal from '../../components/customer/AreaManagerModal';
import { formatRupiah } from '../../layouts/CustomerLayout';
import { buildApiAssetUrl } from '../../config/config';

function statusInfo(camera) {
    if (camera.billing_status === 'suspended') {
        return { label: 'Ditangguhkan', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
    }
    if (camera.is_online === 0 || camera.availability_state === 'offline') {
        return { label: 'Offline', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
    }
    return { label: 'Online', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' };
}

export default function MyCameras() {
    const [cameras, setCameras] = useState([]);
    const [areas, setAreas] = useState([]);
    const [planState, setPlanState] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [activeCamera, setActiveCamera] = useState(null);
    const [formCamera, setFormCamera] = useState(undefined); // undefined=closed, null=add, object=edit
    const [showAreas, setShowAreas] = useState(false);
    const [busyId, setBusyId] = useState(null);

    const reload = useCallback(async () => {
        // Cameras + plan + areas load in parallel (plan/areas are best-effort — their
        // failure never blocks the camera list).
        const [camerasResult, planResult, areasResult] = await Promise.allSettled([
            customerService.getMyCameras(),
            customerService.getPlan(),
            customerService.getAreas(),
        ]);

        if (camerasResult.status === 'fulfilled' && camerasResult.value?.success) {
            setCameras(camerasResult.value.data || []);
            setError(null);
        } else {
            setError(camerasResult.value?.message || 'Gagal memuat kamera. Coba muat ulang halaman.');
        }
        setLoading(false);

        setPlanState(
            planResult.status === 'fulfilled' && planResult.value?.success
                ? planResult.value.data
                : null
        );
        setAreas(
            areasResult.status === 'fulfilled' && areasResult.value?.success
                ? areasResult.value.data || []
                : []
        );
    }, []);

    useEffect(() => {
        reload();
    }, [reload]);

    // Create an area inline from the camera form; refresh the list and return the new
    // area so the form can select it immediately.
    const handleAreaCreated = useCallback(async (name) => {
        const res = await customerService.createArea(name);
        if (res.success) {
            const list = await customerService.getAreas();
            if (list.success) {
                setAreas(list.data || []);
            }
            return res.data;
        }
        return null;
    }, []);

    const handleDelete = async (camera) => {
        if (!window.confirm(`Hapus kamera "${camera.name}"? Tagihan kamera ini berhenti dan stream-nya dimatikan.`)) {
            return;
        }
        setBusyId(camera.id);
        setNotice(null);
        try {
            const response = await customerService.deleteCamera(camera.id);
            if (response.success) {
                setNotice({ type: 'ok', text: `Kamera "${camera.name}" dihapus.` });
                await reload();
            } else {
                setNotice({ type: 'error', text: response.message || 'Gagal menghapus kamera' });
            }
        } catch (err) {
            setNotice({ type: 'error', text: err.response?.data?.message || 'Gagal menghapus kamera' });
        } finally {
            setBusyId(null);
        }
    };

    if (loading) {
        return <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat kamera…</div>;
    }

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                {error}
            </div>
        );
    }

    const canAdd = planState?.can_add_camera;
    const limitLabel = planState?.plan
        ? `${planState.used_cameras}/${planState.max_cameras} kamera (${planState.plan.name})`
        : null;

    return (
        <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                    {limitLabel || 'Kamera yang Anda sewa'}
                    {planState?.plan && !canAdd && !planState.trial_expired && planState.used_cameras >= planState.max_cameras && (
                        <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                            Penuh — <Link to="/my/paket" className="underline">upgrade paket</Link> untuk menambah.
                        </span>
                    )}
                    {planState?.trial_expired && (
                        <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                            Trial berakhir — <Link to="/my/paket" className="underline">pilih paket</Link> agar kamera aktif lagi.
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowAreas(true)}
                        className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                        Kelola Area
                    </button>
                    {planState?.plan && (
                        <button
                            onClick={() => setFormCamera(null)}
                            disabled={!canAdd}
                            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            + Tambah Kamera
                        </button>
                    )}
                </div>
            </div>

            {notice && (
                <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${notice.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                }`}>
                    {notice.text}
                </div>
            )}

            {cameras.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-900">
                    <p className="text-4xl">📷</p>
                    <h2 className="mt-3 font-semibold text-gray-900 dark:text-white">Belum ada kamera</h2>
                    <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
                        {planState?.plan
                            ? 'Tambahkan kamera pertama Anda dengan tombol "+ Tambah Kamera" di atas.'
                            : 'Pilih paket dulu di menu Paket, lalu tambahkan kamera Anda sendiri — atau hubungi admin.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {cameras.map((camera) => {
                        const status = statusInfo(camera);
                        const suspended = camera.billing_status === 'suspended';
                        return (
                            <div
                                key={camera.id}
                                className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
                            >
                                <button
                                    onClick={() => setActiveCamera(camera)}
                                    className="relative block aspect-video w-full bg-gray-200 text-left dark:bg-gray-800"
                                >
                                    {camera.thumbnail_path ? (
                                        <img
                                            src={buildApiAssetUrl(camera.thumbnail_path)}
                                            alt={camera.name}
                                            loading="lazy"
                                            className={`h-full w-full object-cover ${suspended ? 'opacity-40 grayscale' : ''}`}
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-3xl">📹</div>
                                    )}
                                    <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>
                                        {status.label}
                                    </span>
                                    {!suspended && (
                                        <span className="absolute inset-0 hidden items-center justify-center bg-black/40 text-white group-hover:flex">
                                            ▶ Lihat Live
                                        </span>
                                    )}
                                </button>
                                <div className="p-3">
                                    <div className="flex items-center gap-1.5">
                                        <h3 className="truncate font-semibold text-gray-900 dark:text-white">{camera.name}</h3>
                                        {camera.customer_area_name && (
                                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                                {camera.customer_area_name}
                                            </span>
                                        )}
                                    </div>
                                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                                        {camera.location || '—'}
                                    </p>
                                    {camera.monthly_price && (
                                        <p className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                                            {formatRupiah(camera.monthly_price)}/bulan
                                        </p>
                                    )}
                                    {suspended && (
                                        <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                                            Saldo habis —{' '}
                                            <Link to="/my/wallet" className="underline">isi saldo</Link>{' '}
                                            untuk mengaktifkan.
                                        </p>
                                    )}
                                    <div className="mt-2 flex gap-1">
                                        <button
                                            onClick={() => setFormCamera(camera)}
                                            disabled={busyId === camera.id}
                                            className="rounded-lg px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                                        >
                                            ✏️ Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(camera)}
                                            disabled={busyId === camera.id}
                                            className="rounded-lg px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                        >
                                            🗑 Hapus
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {activeCamera && (
                <CustomerLivePlayer camera={activeCamera} onClose={() => setActiveCamera(null)} />
            )}
            {formCamera !== undefined && (
                <CameraFormModal
                    camera={formCamera}
                    areas={areas}
                    onAreaCreated={handleAreaCreated}
                    onClose={() => setFormCamera(undefined)}
                    onSaved={async () => {
                        setFormCamera(undefined);
                        setNotice({ type: 'ok', text: 'Kamera tersimpan.' });
                        await reload();
                    }}
                />
            )}
            {showAreas && (
                <AreaManagerModal
                    areas={areas}
                    onClose={() => setShowAreas(false)}
                    onChanged={reload}
                />
            )}
        </>
    );
}
