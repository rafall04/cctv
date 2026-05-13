/*
 * Purpose: Render admin playback token list with editable policy fields and row actions.
 * Caller: PlaybackTokenManagement page.
 * Deps: React props and playback token hook helpers.
 * MainFuncs: PlaybackTokenTable.
 * SideEffects: Invokes row action callbacks supplied by page hook.
 */

import { PLAYBACK_TOKEN_SESSION_LIMIT_MODES, formatPlaybackTokenSessionPolicy } from '../../../hooks/admin/usePlaybackTokenManagementPage.js';

function scopeLabel(token) {
    const count = token.allowed_camera_ids?.length || token.camera_ids?.length || token.camera_rules?.filter((rule) => rule.enabled !== false).length || 0;
    return token.scope_type === 'selected' ? `${count} kamera` : 'Semua';
}

export default function PlaybackTokenTable({
    tokens,
    loading,
    editingTokenId,
    updatingTokenId,
    sharingTokenId,
    editForm,
    selectedEditCameraIds,
    cameras,
    visibleEditCameras = cameras,
    editCameraSearch = '',
    totalCameraCount = cameras.length,
    visibleEditCameraCount = visibleEditCameras.length,
    formatTokenDate,
    onRefresh,
    onEdit,
    onCancelEdit,
    onUpdateEditForm,
    onUpdateEditCameraSearch,
    onToggleEditCameraRule,
    onUpdateEditCameraRule,
    onUpdateToken,
    onRepeatShare,
    onClearSessions,
    onRevoke,
}) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Token Aktif</h2>
                <button onClick={onRefresh} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">Refresh</button>
            </div>
            {loading ? (
                <div className="py-8 text-center text-sm text-gray-500">Loading...</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-3 py-2">Nama</th>
                                <th className="px-3 py-2">Scope</th>
                                <th className="px-3 py-2">Session</th>
                                <th className="px-3 py-2">Expired</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {tokens.map((token) => (
                                <tr key={token.id} className="text-gray-800 dark:text-gray-200">
                                    <td className="px-3 py-3">
                                        {editingTokenId === token.id ? (
                                            <input value={editForm.label} onChange={(event) => onUpdateEditForm('label', event.target.value)} className="w-52 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                                        ) : (
                                            <>
                                                <div className="font-medium">{token.label}</div>
                                                <div className="text-xs text-gray-500">{token.token_prefix}...</div>
                                            </>
                                        )}
                                    </td>
                                    <td className="px-3 py-3">
                                        {editingTokenId === token.id ? (
                                            <div className="min-w-72 space-y-2">
                                                <select value={editForm.scope_type} onChange={(event) => onUpdateEditForm('scope_type', event.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                                    <option value="all">Semua</option>
                                                    <option value="selected">Kamera tertentu</option>
                                                </select>
                                                {editForm.scope_type === 'selected' && (
                                                    <div className="space-y-2">
                                                        <input
                                                            type="search"
                                                            value={editCameraSearch}
                                                            onChange={(event) => onUpdateEditCameraSearch?.(event.target.value)}
                                                            placeholder="Filter nama CCTV"
                                                            className="w-full rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                                                        />
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">Menampilkan {visibleEditCameraCount} dari {totalCameraCount} CCTV</div>
                                                        <div className="max-h-48 space-y-2 overflow-y-auto">
                                                            {visibleEditCameras.map((camera) => (
                                                                <div key={camera.id} className="rounded bg-gray-50 p-2 dark:bg-gray-950">
                                                                    <label className="flex items-center gap-2 text-xs">
                                                                        <input type="checkbox" checked={selectedEditCameraIds.has(camera.id)} onChange={() => onToggleEditCameraRule(camera.id)} />
                                                                        <span>{camera.name}</span>
                                                                    </label>
                                                                    {selectedEditCameraIds.has(camera.id) && (
                                                                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                                                                            <input type="number" min="1" placeholder="Window jam" value={editForm.camera_rules[camera.id]?.playback_window_hours || ''} onChange={(event) => onUpdateEditCameraRule(camera.id, 'playback_window_hours', event.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                                                                            <input placeholder="Catatan" value={editForm.camera_rules[camera.id]?.note || ''} onChange={(event) => onUpdateEditCameraRule(camera.id, 'note', event.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : scopeLabel(token)}
                                    </td>
                                    <td className="px-3 py-3">
                                        {editingTokenId === token.id ? (
                                            <div className="grid min-w-80 gap-2 sm:grid-cols-3">
                                                <input type="number" min="0" value={editForm.max_active_sessions} onChange={(event) => onUpdateEditForm('max_active_sessions', event.target.value)} placeholder="Unlimited" className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                                                <select value={editForm.session_limit_mode} onChange={(event) => onUpdateEditForm('session_limit_mode', event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                                    {PLAYBACK_TOKEN_SESSION_LIMIT_MODES.filter((mode) => mode.value).map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                                                </select>
                                                <input type="number" min="30" max="3600" value={editForm.session_timeout_seconds} onChange={(event) => onUpdateEditForm('session_timeout_seconds', event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                                                <textarea rows={3} value={editForm.share_template} onChange={(event) => onUpdateEditForm('share_template', event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-3 dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                                            </div>
                                        ) : (
                                            <>
                                                <div>{formatPlaybackTokenSessionPolicy(token)}</div>
                                                <div className="text-xs text-gray-500">TTL {token.session_timeout_seconds || 60}s</div>
                                            </>
                                        )}
                                    </td>
                                    <td className="px-3 py-3">{formatTokenDate(token.expires_at)}</td>
                                    <td className="px-3 py-3">
                                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${token.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                            {token.is_active ? 'Aktif' : 'Nonaktif'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-right">
                                        {token.is_active && (
                                            <div className="flex flex-wrap justify-end gap-2">
                                                {editingTokenId === token.id ? (
                                                    <>
                                                        <button onClick={() => onUpdateToken(token.id)} disabled={updatingTokenId === token.id || !editForm.label.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-60">{updatingTokenId === token.id ? 'Menyimpan...' : 'Simpan'}</button>
                                                        <button onClick={onCancelEdit} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200">Batal</button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button onClick={() => onEdit(token)} className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">Edit</button>
                                                        <button onClick={() => onRepeatShare(token.id)} disabled={sharingTokenId === token.id} className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">{sharingTokenId === token.id ? 'Membuat...' : 'Share'}</button>
                                                        {(token.active_session_count || 0) > 0 && <button onClick={() => onClearSessions(token.id)} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">Clear Session</button>}
                                                        <button onClick={() => onRevoke(token.id)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">Cabut</button>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
