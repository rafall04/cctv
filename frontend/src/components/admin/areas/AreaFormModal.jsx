/*
 * Purpose: Render admin area create/edit modal form and emit page-owned form callbacks.
 * Caller: AreaManagement create/edit modal.
 * Deps: React Suspense, UI Alert, area coverage and admin area option constants.
 * MainFuncs: AreaFormModal.
 * SideEffects: None beyond callback props.
 */

import { Suspense } from 'react';
import { Alert } from '../../ui';
import { AREA_COVERAGE_OPTIONS } from '../../../utils/areaCoverage';
import { GRID_DEFAULT_LIMIT_OPTIONS, INTERNAL_INGEST_POLICY_OPTIONS } from '../../../utils/admin/areaManagementOptions';

export default function AreaFormModal({
    editingArea,
    formData,
    formErrors,
    error,
    submitting,
    LocationPickerComponent,
    onChange,
    onSubmit,
    onClose,
    onErrorDismiss,
    onLocationChange,
}) {
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700/50 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{editingArea ? 'Edit Area' : 'Tambah Area'}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Isi detail lokasi</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-300">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
                <form onSubmit={onSubmit} className="p-6 space-y-5">
                    {error && <Alert type="error" message={error} dismissible onDismiss={onErrorDismiss} />}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nama Area *</label>
                        <input type="text" name="name" value={formData.name} onChange={onChange}
                            className={`w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary ${formErrors.name ? 'border-red-500' : 'border-gray-200 dark:border-gray-700/50'}`}
                            placeholder="Contoh: Pos Kamling RT 01" />
                        {formErrors.name && <p className="mt-1.5 text-sm text-red-500">{formErrors.name}</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">RT</label>
                            <input type="text" name="rt" value={formData.rt} onChange={onChange}
                                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="01" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">RW</label>
                            <input type="text" name="rw" value={formData.rw} onChange={onChange}
                                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="05" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Kelurahan</label>
                            <input type="text" name="kelurahan" value={formData.kelurahan} onChange={onChange}
                                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Nama kelurahan" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Kecamatan</label>
                            <input type="text" name="kecamatan" value={formData.kecamatan} onChange={onChange}
                                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Nama kecamatan" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Deskripsi</label>
                        <textarea name="description" value={formData.description} onChange={onChange} rows="2"
                            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none" placeholder="Catatan opsional..." />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Default Health Monitoring External</label>
                        <select
                            name="external_health_mode_override"
                            value={formData.external_health_mode_override}
                            onChange={onChange}
                            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            {[
                                { value: 'default', label: 'Ikuti Global Default' },
                                { value: 'passive_first', label: 'Passive First' },
                                { value: 'hybrid_probe', label: 'Hybrid Probe' },
                                { value: 'probe_first', label: 'Probe First' },
                                { value: 'disabled', label: 'Disabled' },
                            ].map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Override ini menjadi default steady-state untuk kamera external di area ini. Kamera dengan override sendiri tetap menang.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Coverage Area</label>
                            <select
                                name="coverage_scope"
                                value={formData.coverage_scope}
                                onChange={onChange}
                                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                {AREA_COVERAGE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                Menjelaskan skala area ini, misalnya titik kecil, kelurahan, kecamatan, atau kabupaten/kota.
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Override Focus Zoom</label>
                            <input
                                type="number"
                                min="1"
                                max="20"
                                name="viewport_zoom_override"
                                value={formData.viewport_zoom_override}
                                onChange={onChange}
                                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="Kosongkan untuk auto"
                            />
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                Jika diisi, zoom ini akan dipakai saat area difokuskan di map view.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 dark:border-sky-500/20 dark:bg-sky-500/10">
                        <label className="flex items-start gap-3">
                            <input
                                type="checkbox"
                                name="show_on_grid_default"
                                checked={Boolean(formData.show_on_grid_default)}
                                onChange={onChange}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <span>
                                <span className="block text-sm font-medium text-gray-900 dark:text-white">Tampilkan di Grid Default</span>
                                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                                    Saat Grid View masih di &quot;Semua Lokasi&quot;, hanya area yang dicentang di sini yang dimuat default. Jika user memilih area tertentu, area itu tetap tampil walau opsi ini dimatikan.
                                </span>
                            </span>
                        </label>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Limit Kamera di Grid Default</label>
                        <select
                            name="grid_default_camera_limit"
                            value={formData.grid_default_camera_limit}
                            onChange={onChange}
                            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            {GRID_DEFAULT_LIMIT_OPTIONS.map((option) => (
                                <option key={`form-${option.value || 'unlimited'}`} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Untuk area padat, batasi jumlah kamera default seperti 10 atau 15 agar Grid View tetap ringan. Saat user memilih area tertentu, limit ini diabaikan.
                        </p>
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                        <div className="mb-3">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Internal RTSP / MediaMTX Policy</h4>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                Default area ini hanya dipakai oleh kamera internal yang tidak punya override sendiri di form kamera.
                            </p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Default Ingest Mode</label>
                                <select
                                    name="internal_ingest_policy_default"
                                    value={formData.internal_ingest_policy_default}
                                    onChange={onChange}
                                    className="w-full px-4 py-2.5 bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                >
                                    {INTERNAL_INGEST_POLICY_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Idle Close Timeout (detik)</label>
                                <input
                                    type="number"
                                    min="5"
                                    max="300"
                                    name="internal_on_demand_close_after_seconds"
                                    value={formData.internal_on_demand_close_after_seconds}
                                    onChange={onChange}
                                    className="w-full px-4 py-2.5 bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="Kosong = ikuti default"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="pt-4 border-t border-gray-200 dark:border-gray-700/50">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Koordinat Area (untuk Map View)</label>
                        <Suspense fallback={<div className="text-sm text-gray-600 dark:text-gray-300">Loading map...</div>}>
                            <LocationPickerComponent latitude={formData.latitude} longitude={formData.longitude} onLocationChange={onLocationChange} />
                        </Suspense>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Koordinat digunakan untuk memindahkan peta saat filter area dipilih</p>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700" disabled={submitting}>Batal</button>
                        <button type="submit" className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-primary to-primary-600 text-white font-medium rounded-xl shadow-lg shadow-primary/30 hover:from-primary-600 hover:to-blue-700 disabled:opacity-50 flex items-center justify-center gap-2" disabled={submitting}>
                            {submitting && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                            {submitting ? 'Menyimpan...' : (editingArea ? 'Perbarui' : 'Simpan')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
