/*
 * Purpose: Render admin area create/edit form inside the one dialog shell and emit page-owned form callbacks.
 * Caller: AreaManagement create/edit modal.
 * Deps: React Suspense, ui/Modal + ui/Button + ui/Alert, area coverage and admin area option constants.
 * MainFuncs: AreaFormModal.
 * SideEffects: None beyond callback props — the shell owns the focus trap, Escape and the body
 *   scroll lock (which this file used to lack entirely: a touch-drag aimed at the form scrolled the
 *   40-card area LIST underneath it, and `max-h-[90vh]` let the panel run past a phone's visible
 *   viewport because `vh` still counts the URL bar).
 *
 * `dismissible={false}` is deliberately the OPPOSITE of ui/Modal's default: this is a 14-field form
 * with a map picker in it, and a stray tap on the scrim would discard the draft with nothing to undo
 * it. (The comment that used to sit here claimed there was no Escape-to-close — it was false, the
 * old code passed `onEscape: onClose` and Escape did discard the input. It is gone now for real.)
 *
 * The footer Simpan sits OUTSIDE <form>, joined to it only by `form="area-form"`. A stale id does
 * not throw; the button just silently stops saving — AreaFormModal.test.jsx asserts the association.
 */

import { Suspense } from 'react';
import { Alert, Button, Modal } from '../../ui';
import { AREA_COVERAGE_OPTIONS } from '../../../utils/areaCoverage';
import { GRID_DEFAULT_LIMIT_OPTIONS, INTERNAL_INGEST_POLICY_OPTIONS, INTERNAL_RTSP_TRANSPORT_OPTIONS } from '../../../utils/admin/areaManagementOptions';

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
        <Modal
            title={editingArea ? 'Edit Area' : 'Tambah Area'}
            description="Isi detail lokasi"
            size="md"
            onClose={onClose}
            dismissible={false}
            footer={(
                <>
                    <Button onClick={onClose} disabled={submitting}>Batal</Button>
                    <Button type="submit" form="area-form" variant="primary" loading={submitting}>
                        {editingArea ? 'Perbarui' : 'Simpan'}
                    </Button>
                </>
            )}
        >
            <form id="area-form" onSubmit={onSubmit} className="space-y-5">
                {error && <Alert type="error" message={error} dismissible onDismiss={onErrorDismiss} />}

                <div>
                    <label className="block text-sm font-medium text-content-muted mb-1.5">Nama Area *</label>
                    <input type="text" name="name" value={formData.name} onChange={onChange}
                        className={`w-full px-4 py-2.5 bg-surface-sunken border rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary ${formErrors.name ? 'border-status-fault' : 'border-edge'}`}
                        placeholder="Contoh: Pos Kamling RT 01" />
                    {formErrors.name && <p className="mt-1.5 text-sm text-status-fault">{formErrors.name}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                        <label className="block text-sm font-medium text-content-muted mb-1.5">RT</label>
                        <input type="text" name="rt" value={formData.rt} onChange={onChange}
                            className="w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary" placeholder="01" />
                    </div>
                    <div className="min-w-0">
                        <label className="block text-sm font-medium text-content-muted mb-1.5">RW</label>
                        <input type="text" name="rw" value={formData.rw} onChange={onChange}
                            className="w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary" placeholder="05" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                        <label className="block text-sm font-medium text-content-muted mb-1.5">Kelurahan</label>
                        <input type="text" name="kelurahan" value={formData.kelurahan} onChange={onChange}
                            className="w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary" placeholder="Nama kelurahan" />
                    </div>
                    <div className="min-w-0">
                        <label className="block text-sm font-medium text-content-muted mb-1.5">Kecamatan</label>
                        <input type="text" name="kecamatan" value={formData.kecamatan} onChange={onChange}
                            className="w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary" placeholder="Nama kecamatan" />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-content-muted mb-1.5">Deskripsi</label>
                    <textarea name="description" value={formData.description} onChange={onChange} rows="2"
                        className="w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary resize-none" placeholder="Catatan opsional..." />
                </div>

                <div>
                    <label className="block text-sm font-medium text-content-muted mb-1.5">Default Health Monitoring External</label>
                    <select
                        name="external_health_mode_override"
                        value={formData.external_health_mode_override}
                        onChange={onChange}
                        className="w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
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
                    <p className="mt-2 text-xs text-content-muted">
                        Override ini menjadi default steady-state untuk kamera external di area ini. Kamera dengan override sendiri tetap menang.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                        <label className="block text-sm font-medium text-content-muted mb-1.5">Coverage Area</label>
                        <select
                            name="coverage_scope"
                            value={formData.coverage_scope}
                            onChange={onChange}
                            className="w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        >
                            {AREA_COVERAGE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <p className="mt-2 text-xs text-content-muted">
                            Menjelaskan skala area ini, misalnya titik kecil, kelurahan, kecamatan, atau kabupaten/kota.
                        </p>
                    </div>
                    <div className="min-w-0">
                        <label className="block text-sm font-medium text-content-muted mb-1.5">Override Focus Zoom</label>
                        <input
                            type="number"
                            min="1"
                            max="20"
                            name="viewport_zoom_override"
                            value={formData.viewport_zoom_override}
                            onChange={onChange}
                            className="w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                            placeholder="Kosongkan untuk auto"
                        />
                        <p className="mt-2 text-xs text-content-muted">
                            Jika diisi, zoom ini akan dipakai saat area difokuskan di map view.
                        </p>
                    </div>
                </div>

                <div className="rounded-card border border-primary-300 bg-primary-100 px-4 py-3 dark:bg-primary/10">
                    <label className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            name="show_on_grid_default"
                            checked={Boolean(formData.show_on_grid_default)}
                            onChange={onChange}
                            className="mt-1 h-4 w-4 shrink-0 rounded border-edge-strong text-primary focus:ring-primary"
                        />
                        <span className="min-w-0">
                            <span className="block text-sm font-medium text-content">Tampilkan di Grid Default</span>
                            <span className="mt-1 block text-xs text-content-muted">
                                Saat Grid View masih di &quot;Semua Lokasi&quot;, hanya area yang dicentang di sini yang dimuat default. Jika user memilih area tertentu, area itu tetap tampil walau opsi ini dimatikan.
                            </span>
                        </span>
                    </label>
                </div>

                <div>
                    <label className="block text-sm font-medium text-content-muted mb-1.5">Limit Kamera di Grid Default</label>
                    <select
                        name="grid_default_camera_limit"
                        value={formData.grid_default_camera_limit}
                        onChange={onChange}
                        className="w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                    >
                        {GRID_DEFAULT_LIMIT_OPTIONS.map((option) => (
                            <option key={`form-${option.value || 'unlimited'}`} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <p className="mt-2 text-xs text-content-muted">
                        Untuk area padat, batasi jumlah kamera default seperti 10 atau 15 agar Grid View tetap ringan. Saat user memilih area tertentu, limit ini diabaikan.
                    </p>
                </div>

                {/* A grouping box, not a status: neutral surface tokens rather than the old emerald
                    tint, which read as "healthy" for something that reports nothing. */}
                <div className="rounded-card border border-edge-strong bg-surface-sunken px-4 py-4">
                    <div className="mb-3">
                        <h4 className="text-sm font-semibold text-content">Internal RTSP / MediaMTX Policy</h4>
                        <p className="mt-1 text-xs text-content-muted">
                            Default area ini hanya dipakai oleh kamera internal yang tidak punya override sendiri di form kamera.
                        </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="min-w-0">
                            <label htmlFor="area-internal-ingest-policy" className="block text-sm font-medium text-content-muted mb-1.5">Default Ingest Mode</label>
                            <select
                                id="area-internal-ingest-policy"
                                name="internal_ingest_policy_default"
                                value={formData.internal_ingest_policy_default}
                                onChange={onChange}
                                className="w-full px-4 py-2.5 bg-surface border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                            >
                                {INTERNAL_INGEST_POLICY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="min-w-0">
                            <label htmlFor="area-internal-rtsp-transport" className="block text-sm font-medium text-content-muted mb-1.5">Default RTSP Transport</label>
                            <select
                                id="area-internal-rtsp-transport"
                                name="internal_rtsp_transport_default"
                                value={formData.internal_rtsp_transport_default || 'default'}
                                onChange={onChange}
                                className="w-full px-4 py-2.5 bg-surface border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                            >
                                {INTERNAL_RTSP_TRANSPORT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="min-w-0">
                            <label className="block text-sm font-medium text-content-muted mb-1.5">Idle Close Timeout (detik)</label>
                            <input
                                type="number"
                                min="5"
                                max="300"
                                name="internal_on_demand_close_after_seconds"
                                value={formData.internal_on_demand_close_after_seconds}
                                onChange={onChange}
                                className="w-full px-4 py-2.5 bg-surface border border-edge rounded-card text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                                placeholder="Kosong = ikuti default"
                            />
                        </div>
                    </div>
                </div>

                <div className="pt-4 border-t border-edge">
                    <label className="block text-sm font-medium text-content-muted mb-3">Koordinat Area (untuk Map View)</label>
                    <Suspense fallback={<div className="text-sm text-content-muted">Loading map...</div>}>
                        <LocationPickerComponent latitude={formData.latitude} longitude={formData.longitude} onLocationChange={onLocationChange} />
                    </Suspense>
                    <p className="text-xs text-content-muted mt-2">Koordinat digunakan untuk memindahkan peta saat filter area dipilih</p>
                </div>
            </form>
        </Modal>
    );
}
