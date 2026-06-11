/*
 * Purpose: Add/edit form modal for customer self-service cameras (name, lokasi, deskripsi,
 *          RTSP URL) — the RTSP URL is write-only on edit (backend never returns it).
 * Caller: pages/customer/MyCameras.jsx.
 * Deps: customerService.
 * MainFuncs: CameraFormModal.
 * SideEffects: Creates/updates the camera via API on submit.
 */

import { useState } from 'react';
import customerService from '../../services/customerService';

const inputClass = 'w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary';

export default function CameraFormModal({ camera = null, onClose, onSaved }) {
    const isEdit = !!camera;
    const [form, setForm] = useState({
        name: camera?.name || '',
        location: camera?.location || '',
        description: camera?.description || '',
        private_rtsp_url: '',
    });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isEdit && !form.private_rtsp_url.trim()) {
            setError('URL RTSP wajib diisi');
            return;
        }
        setSubmitting(true);
        try {
            const payload = {
                name: form.name.trim(),
                location: form.location.trim() || undefined,
                description: form.description.trim() || undefined,
            };
            if (form.private_rtsp_url.trim()) {
                payload.private_rtsp_url = form.private_rtsp_url.trim();
            }
            const response = isEdit
                ? await customerService.updateCamera(camera.id, payload)
                : await customerService.createCamera(payload);
            if (response.success) {
                onSaved();
            } else {
                setError(response.message || 'Gagal menyimpan kamera');
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Gagal menyimpan kamera');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    {isEdit ? `Edit ${camera.name}` : 'Tambah Kamera'}
                </h3>
                <form onSubmit={handleSubmit} className="mt-3 space-y-3">
                    <div>
                        <label htmlFor="cam-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Nama kamera</label>
                        <input id="cam-name" name="name" value={form.name} onChange={handleChange} required minLength={2} maxLength={100} className={inputClass} placeholder="Kamera Depan Toko" />
                    </div>
                    <div>
                        <label htmlFor="cam-location" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Lokasi (opsional)</label>
                        <input id="cam-location" name="location" value={form.location} onChange={handleChange} maxLength={120} className={inputClass} placeholder="Jl. Mawar No. 1" />
                    </div>
                    <div>
                        <label htmlFor="cam-desc" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Deskripsi (opsional)</label>
                        <input id="cam-desc" name="description" value={form.description} onChange={handleChange} maxLength={200} className={inputClass} />
                    </div>
                    <div>
                        <label htmlFor="cam-rtsp" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            URL RTSP {isEdit && <span className="font-normal text-gray-400">(kosongkan jika tidak diganti)</span>}
                        </label>
                        <input id="cam-rtsp" name="private_rtsp_url" value={form.private_rtsp_url} onChange={handleChange} maxLength={500} className={inputClass} placeholder="rtsp://user:pass@ip-kamera:554/stream" />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Dari aplikasi kamera/NVR Anda. Pastikan kamera bisa diakses dari jaringan RAF NET.
                        </p>
                    </div>

                    {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>}

                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={onClose} disabled={submitting} className="flex-1 rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                            Batal
                        </button>
                        <button type="submit" disabled={submitting} className="flex-[2] rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-60">
                            {submitting ? 'Menyimpan…' : (isEdit ? 'Simpan' : 'Tambah Kamera')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
