/*
 * Purpose: Render admin playback token create form with scope, session, share template, and per-camera rule controls.
 * Caller: PlaybackTokenManagement page.
 * Deps: React props, playback token hook constants.
 * MainFuncs: PlaybackTokenForm.
 * SideEffects: Invokes form callbacks supplied by the page hook.
 */

import { PLAYBACK_TOKEN_PRESETS, PLAYBACK_TOKEN_SESSION_LIMIT_MODES } from '../../../hooks/admin/usePlaybackTokenManagementPage.js';
import { DURATION_UNITS, friendlyToHours } from '../../../utils/durationUnits.js';
import { describeTokenLimits } from '../../../utils/playbackTokenSummary.js';

export default function PlaybackTokenForm({
    form,
    cameras,
    saving,
    selectedCameraIds,
    areaOptions = [],
    onToggleArea,
    cameraSearch = '',
    totalCameraCount = cameras.length,
    visibleCameraCount = cameras.length,
    onUpdateForm,
    onPresetChange,
    onUpdateCameraSearch,
    onToggleCameraRule,
    onUpdateCameraRule,
    onSubmit,
}) {
    const isRange = form.depth_mode === 'range';
    const limitSummary = describeTokenLimits({
        windowHours: isRange ? null : friendlyToHours(form.playback_window_value, form.playback_window_unit),
        playbackFrom: isRange ? (form.playback_from || null) : null,
        playbackTo: isRange ? (form.playback_to || null) : null,
        expiresAt: form.expires_at || null,
        scopeType: form.scope_type,
        cameraCount: selectedCameraIds.size,
        areaCount: (form.area_ids || []).length,
    });
    const modeBtn = (active) => `flex-1 rounded-control px-2 py-1 text-xs font-medium ${active ? 'bg-primary text-white' : 'bg-surface-sunken text-content-muted'}`;
    return (
        <form onSubmit={onSubmit} className="rounded-lg border border-edge bg-surface p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-content-muted">Nama Token</span>
                    <input value={form.label} onChange={(event) => onUpdateForm('label', event.target.value)} className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white" />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-content-muted">Preset (isi cepat)</span>
                    <select value={form.preset} onChange={(event) => onPresetChange(event.target.value)} className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white">
                        {PLAYBACK_TOKEN_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
                    </select>
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-content-muted">Scope Kamera</span>
                    <select value={form.scope_type} onChange={(event) => onUpdateForm('scope_type', event.target.value)} className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white">
                        <option value="all">Semua kamera playback</option>
                        <option value="area">Per area</option>
                        <option value="selected">Kamera tertentu</option>
                    </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                        {/*
                          * "Window Jam" meant nothing to the operator who owns this form — it was
                          * read as a time window to schedule, not as how far back the footage may
                          * be reached. Same field, same behaviour; it just says what it does now.
                          */}
                        <span className="mb-1 block text-sm font-medium text-content-muted">Batas kedalaman</span>
                        <div className="mb-2 flex gap-1">
                            <button type="button" onClick={() => onUpdateForm('depth_mode', 'rolling')} className={modeBtn(!isRange)}>N terakhir</button>
                            <button type="button" onClick={() => onUpdateForm('depth_mode', 'range')} className={modeBtn(isRange)}>Rentang tanggal</button>
                        </div>
                        {isRange ? (
                            <div className="flex gap-2">
                                <label className="block w-full">
                                    <span className="mb-1 block text-xs text-content-subtle">Dari</span>
                                    <input type="datetime-local" step="600" value={form.playback_from} onChange={(event) => onUpdateForm('playback_from', event.target.value)} className="w-full rounded-lg border border-edge-strong px-2 py-2 text-sm dark:bg-gray-950 dark:text-white" />
                                </label>
                                <label className="block w-full">
                                    <span className="mb-1 block text-xs text-content-subtle">Sampai</span>
                                    <input type="datetime-local" step="600" value={form.playback_to} onChange={(event) => onUpdateForm('playback_to', event.target.value)} className="w-full rounded-lg border border-edge-strong px-2 py-2 text-sm dark:bg-gray-950 dark:text-white" />
                                </label>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <input type="number" min="1" value={form.playback_window_value} onChange={(event) => onUpdateForm('playback_window_value', event.target.value)} placeholder="Kosong = semua" className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white" />
                                <select value={form.playback_window_unit} onChange={(event) => onUpdateForm('playback_window_unit', event.target.value)} className="rounded-lg border border-edge-strong px-2 py-2 text-sm dark:bg-gray-950 dark:text-white">
                                    {DURATION_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                                </select>
                            </div>
                        )}
                        <span className="mt-1 block text-xs text-content-subtle">{isRange ? 'Hanya rekaman antara dua waktu tsb. Rekaman per segmen 10 menit, jadi jam dibulatkan ke kelipatan 10.' : 'Mis. 7 hari = hanya rekaman 7 hari terakhir. Kosong = semua.'}</span>
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-content-muted">Expired</span>
                        <input type="datetime-local" value={form.expires_at} onChange={(event) => onUpdateForm('expires_at', event.target.value)} className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white" />
                        <span className="mt-1 block text-xs text-content-subtle">Masa berlaku token mengikuti preset; isian ini hanya dipakai di preset Custom/Lifetime.</span>
                    </label>
                </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-4">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-content-muted">Kode Akses</span>
                    <select value={form.access_code_mode} onChange={(event) => onUpdateForm('access_code_mode', event.target.value)} className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white">
                        <option value="auto">Otomatis</option>
                        <option value="custom">Custom</option>
                    </select>
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-content-muted">{form.access_code_mode === 'custom' ? 'Kode Custom' : 'Panjang Kode'}</span>
                    <input value={form.access_code_mode === 'custom' ? form.custom_access_code : form.access_code_length} onChange={(event) => onUpdateForm(form.access_code_mode === 'custom' ? 'custom_access_code' : 'access_code_length', form.access_code_mode === 'custom' ? event.target.value.toUpperCase() : event.target.value)} className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white" />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-content-muted">Limit Device</span>
                    <input type="number" min="0" value={form.max_active_sessions} onChange={(event) => onUpdateForm('max_active_sessions', event.target.value)} placeholder="Preset" className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white" />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-content-muted">Mode Limit</span>
                    <select value={form.session_limit_mode} onChange={(event) => onUpdateForm('session_limit_mode', event.target.value)} className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white">
                        {PLAYBACK_TOKEN_SESSION_LIMIT_MODES.map((mode) => <option key={mode.value || 'preset'} value={mode.value}>{mode.label}</option>)}
                    </select>
                </label>
            </div>

            {form.scope_type === 'area' && (
                <div className="mt-4 rounded-lg border border-edge p-3">
                    <div className="mb-1 text-sm font-medium text-content-muted">Pilih Area</div>
                    {/*
                     * Stated explicitly because it is the whole reason to pick area over "kamera
                     * tertentu", and it is not visible from the checkboxes alone.
                     */}
                    <p className="mb-3 text-xs text-content-subtle">
                        Kamera yang ditambahkan ke area ini nanti otomatis ikut tercakup — token tidak
                        perlu dibuat ulang.
                    </p>
                    {areaOptions.length === 0 ? (
                        <p className="text-sm text-content-muted">Belum ada kamera yang punya area.</p>
                    ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                            {areaOptions.map((area) => (
                                <label key={area.id} className="flex items-center gap-2 rounded-md bg-surface-sunken p-3 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={form.area_ids.includes(area.id)}
                                        onChange={() => onToggleArea(area.id)}
                                    />
                                    <span className="truncate text-content">{area.name}</span>
                                    <span className="ml-auto shrink-0 text-xs text-content-subtle">{area.cameraCount} CCTV</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {form.scope_type === 'selected' && (
                <div className="mt-4 rounded-lg border border-edge p-3">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm font-medium text-content-muted">Pilih Kamera</div>
                        <div className="text-xs text-content-muted">Menampilkan {visibleCameraCount} dari {totalCameraCount} CCTV</div>
                    </div>
                    <input
                        type="search"
                        value={cameraSearch}
                        onChange={(event) => onUpdateCameraSearch?.(event.target.value)}
                        placeholder="Filter nama CCTV"
                        className="mb-3 w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white"
                    />
                    <div className="grid max-h-72 gap-2 overflow-y-auto lg:grid-cols-2">
                        {cameras.map((camera) => (
                            <div key={camera.id} className="rounded-md bg-surface-sunken p-3 text-sm">
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={selectedCameraIds.has(camera.id)} onChange={() => onToggleCameraRule(camera.id)} />
                                    <span className="truncate text-content">{camera.name}</span>
                                </label>
                                {selectedCameraIds.has(camera.id) && (
                                    <div className="mt-2">
                                        <p className="mb-1 text-[11px] text-content-subtle">Khusus kamera ini (opsional — kosong = ikut token):</p>
                                        <div className="grid gap-2 sm:grid-cols-3">
                                            <label className="block">
                                                <span className="mb-0.5 block text-[10px] text-content-subtle">Maks. mundur (jam)</span>
                                                <input type="number" min="1" placeholder="ikut token" value={form.camera_rules[camera.id]?.playback_window_hours || ''} onChange={(event) => onUpdateCameraRule(camera.id, 'playback_window_hours', event.target.value)} className="w-full rounded-lg border border-edge-strong px-2 py-1 text-xs dark:bg-gray-950 dark:text-white" />
                                            </label>
                                            <label className="block">
                                                <span className="mb-0.5 block text-[10px] text-content-subtle">Berlaku sampai</span>
                                                <input type="datetime-local" value={form.camera_rules[camera.id]?.expires_at || ''} onChange={(event) => onUpdateCameraRule(camera.id, 'expires_at', event.target.value)} className="w-full rounded-lg border border-edge-strong px-2 py-1 text-xs dark:bg-gray-950 dark:text-white" />
                                            </label>
                                            <label className="block">
                                                <span className="mb-0.5 block text-[10px] text-content-subtle">Catatan</span>
                                                <input placeholder="—" value={form.camera_rules[camera.id]?.note || ''} onChange={(event) => onUpdateCameraRule(camera.id, 'note', event.target.value)} className="w-full rounded-lg border border-edge-strong px-2 py-1 text-xs dark:bg-gray-950 dark:text-white" />
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <label className="mt-4 block">
                <span className="mb-1 block text-sm font-medium text-content-muted">Template Share</span>
                <textarea rows={5} value={form.share_template} onChange={(event) => onUpdateForm('share_template', event.target.value)} className="w-full rounded-lg border border-edge-strong px-3 py-2 text-sm dark:bg-gray-950 dark:text-white" />
            </label>

            {/* Live preview of the EFFECTIVE limit — so the operator reads what the token grants in
                plain language instead of decoding preset + window + expiry in their head. */}
            <div className="mt-4 rounded-lg border border-edge bg-surface-sunken px-4 py-3 text-sm text-content" data-testid="playback-token-limit-preview">
                <span className="mr-1 font-semibold text-content-muted">Ringkasan:</span>
                {limitSummary}
            </div>

            <div className="mt-4 flex justify-end">
                <button type="submit" disabled={saving || (form.scope_type === 'selected' && selectedCameraIds.size === 0) || (form.scope_type === 'area' && form.area_ids.length === 0)} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60">
                    {saving ? 'Membuat...' : 'Buat Token'}
                </button>
            </div>
        </form>
    );
}
