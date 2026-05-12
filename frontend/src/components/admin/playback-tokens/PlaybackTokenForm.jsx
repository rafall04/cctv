/*
 * Purpose: Render admin playback token create form with scope, session, share template, and per-camera rule controls.
 * Caller: PlaybackTokenManagement page.
 * Deps: React props, playback token hook constants.
 * MainFuncs: PlaybackTokenForm.
 * SideEffects: Invokes form callbacks supplied by the page hook.
 */

import { PLAYBACK_TOKEN_PRESETS, PLAYBACK_TOKEN_SESSION_LIMIT_MODES } from '../../../hooks/admin/usePlaybackTokenManagementPage.js';

export default function PlaybackTokenForm({
    form,
    cameras,
    saving,
    selectedCameraIds,
    onUpdateForm,
    onToggleCameraRule,
    onUpdateCameraRule,
    onSubmit,
}) {
    return (
        <form onSubmit={onSubmit} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Nama Token</span>
                    <input value={form.label} onChange={(event) => onUpdateForm('label', event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Preset</span>
                    <select value={form.preset} onChange={(event) => onUpdateForm('preset', event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                        {PLAYBACK_TOKEN_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
                    </select>
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Scope Kamera</span>
                    <select value={form.scope_type} onChange={(event) => onUpdateForm('scope_type', event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                        <option value="all">Semua kamera playback</option>
                        <option value="selected">Kamera tertentu</option>
                    </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Window Jam</span>
                        <input type="number" min="1" value={form.playback_window_hours} onChange={(event) => onUpdateForm('playback_window_hours', event.target.value)} placeholder="Kosong = full" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Expired</span>
                        <input type="datetime-local" value={form.expires_at} onChange={(event) => onUpdateForm('expires_at', event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                    </label>
                </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-4">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Kode Akses</span>
                    <select value={form.access_code_mode} onChange={(event) => onUpdateForm('access_code_mode', event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                        <option value="auto">Otomatis</option>
                        <option value="custom">Custom</option>
                    </select>
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{form.access_code_mode === 'custom' ? 'Kode Custom' : 'Panjang Kode'}</span>
                    <input value={form.access_code_mode === 'custom' ? form.custom_access_code : form.access_code_length} onChange={(event) => onUpdateForm(form.access_code_mode === 'custom' ? 'custom_access_code' : 'access_code_length', form.access_code_mode === 'custom' ? event.target.value.toUpperCase() : event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Limit Device</span>
                    <input type="number" min="0" value={form.max_active_sessions} onChange={(event) => onUpdateForm('max_active_sessions', event.target.value)} placeholder="Preset" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Mode Limit</span>
                    <select value={form.session_limit_mode} onChange={(event) => onUpdateForm('session_limit_mode', event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                        {PLAYBACK_TOKEN_SESSION_LIMIT_MODES.map((mode) => <option key={mode.value || 'preset'} value={mode.value}>{mode.label}</option>)}
                    </select>
                </label>
            </div>

            {form.scope_type === 'selected' && (
                <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                    <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Pilih Kamera</div>
                    <div className="grid max-h-72 gap-2 overflow-y-auto lg:grid-cols-2">
                        {cameras.map((camera) => (
                            <div key={camera.id} className="rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-950">
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={selectedCameraIds.has(camera.id)} onChange={() => onToggleCameraRule(camera.id)} />
                                    <span className="truncate text-gray-800 dark:text-gray-200">{camera.name}</span>
                                </label>
                                {selectedCameraIds.has(camera.id) && (
                                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                        <input type="number" min="1" placeholder="Window jam" value={form.camera_rules[camera.id]?.playback_window_hours || ''} onChange={(event) => onUpdateCameraRule(camera.id, 'playback_window_hours', event.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                                        <input type="datetime-local" value={form.camera_rules[camera.id]?.expires_at || ''} onChange={(event) => onUpdateCameraRule(camera.id, 'expires_at', event.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                                        <input placeholder="Catatan" value={form.camera_rules[camera.id]?.note || ''} onChange={(event) => onUpdateCameraRule(camera.id, 'note', event.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <label className="mt-4 block">
                <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Template Share</span>
                <textarea rows={5} value={form.share_template} onChange={(event) => onUpdateForm('share_template', event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
            </label>

            <div className="mt-4 flex justify-end">
                <button type="submit" disabled={saving || (form.scope_type === 'selected' && selectedCameraIds.size === 0)} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60">
                    {saving ? 'Membuat...' : 'Buat Token'}
                </button>
            </div>
        </form>
    );
}
