/*
 * Purpose: Customer "Kamera Saya" page — grid of owned cameras with billing badge and a
 *          tokened live player modal (live-only product surface).
 * Caller: App.jsx /my route inside CustomerLayout.
 * Deps: customerService, CustomerLivePlayer, formatRupiah.
 * MainFuncs: MyCameras.
 * SideEffects: Fetches owned cameras on mount.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import customerService from '../../services/customerService';
import CustomerLivePlayer from '../../components/customer/CustomerLivePlayer';
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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeCamera, setActiveCamera] = useState(null);

    useEffect(() => {
        let isMounted = true;
        customerService.getMyCameras()
            .then((response) => {
                if (!isMounted) return;
                if (response.success) {
                    setCameras(response.data || []);
                } else {
                    setError(response.message || 'Gagal memuat kamera');
                }
            })
            .catch(() => isMounted && setError('Gagal memuat kamera. Coba muat ulang halaman.'))
            .finally(() => isMounted && setLoading(false));
        return () => { isMounted = false; };
    }, []);

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

    if (cameras.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-900">
                <p className="text-4xl">📷</p>
                <h2 className="mt-3 font-semibold text-gray-900 dark:text-white">Belum ada kamera</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
                    Kamera yang Anda sewa akan muncul di sini setelah admin menghubungkannya ke akun Anda.
                </p>
            </div>
        );
    }

    return (
        <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cameras.map((camera) => {
                    const status = statusInfo(camera);
                    const suspended = camera.billing_status === 'suspended';
                    return (
                        <button
                            key={camera.id}
                            onClick={() => setActiveCamera(camera)}
                            className="group overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
                        >
                            <div className="relative aspect-video bg-gray-200 dark:bg-gray-800">
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
                            </div>
                            <div className="p-3">
                                <h3 className="truncate font-semibold text-gray-900 dark:text-white">{camera.name}</h3>
                                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                                    {camera.location || camera.area_name || '—'}
                                </p>
                                {camera.monthly_price && (
                                    <p className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                                        {formatRupiah(camera.monthly_price)}/bulan
                                    </p>
                                )}
                                {suspended && (
                                    <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                                        Saldo habis —{' '}
                                        <Link to="/my/wallet" className="underline" onClick={(e) => e.stopPropagation()}>
                                            isi saldo
                                        </Link>{' '}
                                        untuk mengaktifkan.
                                    </p>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
            {activeCamera && (
                <CustomerLivePlayer camera={activeCamera} onClose={() => setActiveCamera(null)} />
            )}
        </>
    );
}
