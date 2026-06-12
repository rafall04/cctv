/*
 * Purpose: Manage the customer's own private areas ("Area Saya") — list with camera counts,
 *          add, and delete. These are a per-customer namespace, never the public community areas.
 * Caller: pages/customer/MyCameras.jsx.
 * Deps: customerService.
 * MainFuncs: AreaManagerModal.
 * SideEffects: Creates/deletes areas via customerService; calls onChanged after each mutation.
 */

import { useState } from 'react';
import customerService from '../../services/customerService';

const inputClass = 'w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary';

export default function AreaManagerModal({ areas = [], onClose, onChanged }) {
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const handleCreate = async (e) => {
        e.preventDefault();
        const clean = name.trim();
        if (!clean) {
            setError('Nama area wajib diisi');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const res = await customerService.createArea(clean);
            if (res.success) {
                setName('');
                await onChanged();
            } else {
                setError(res.message || 'Gagal membuat area');
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Gagal membuat area');
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (area) => {
        if (!window.confirm(`Hapus area "${area.name}"? Kamera di area ini tidak terhapus, hanya lepas dari area.`)) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            const res = await customerService.deleteArea(area.id);
            if (res.success) {
                await onChanged();
            } else {
                setError(res.message || 'Gagal menghapus area');
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Gagal menghapus area');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                className="my-auto flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="shrink-0 border-b border-gray-200 p-5 dark:border-gray-800">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Kelola Area Saya</h3>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        Pengelompokan pribadi kamera Anda (mis. “Rumah”, “Toko Cabang 1”). Hanya Anda yang melihatnya.
                    </p>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                    <form onSubmit={handleCreate} className="flex gap-2">
                        <input
                            value={name}
                            onChange={(e) => { setName(e.target.value); setError(''); }}
                            maxLength={40}
                            className={inputClass}
                            placeholder="Nama area baru…"
                        />
                        <button
                            type="submit"
                            disabled={busy}
                            className="shrink-0 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                        >
                            Tambah
                        </button>
                    </form>

                    {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>}

                    {areas.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                            Belum ada area. Tambahkan di atas, lalu pilih saat menambah/edit kamera.
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {areas.map((area) => (
                                <li key={area.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 dark:border-gray-800">
                                    <span className="flex-1 truncate text-sm text-gray-800 dark:text-gray-200">{area.name}</span>
                                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                        {area.camera_count || 0} kamera
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(area)}
                                        disabled={busy}
                                        className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                                    >
                                        Hapus
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="shrink-0 border-t border-gray-200 p-4 dark:border-gray-800">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                        Tutup
                    </button>
                </div>
            </div>
        </div>
    );
}
