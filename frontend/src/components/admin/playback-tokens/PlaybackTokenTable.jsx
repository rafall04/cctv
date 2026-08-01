/*
 * Purpose: List playback tokens as cards — identity first, then policy, then the actions for that
 *          one token.
 * Caller: PlaybackTokenManagement page.
 * Deps: React props, components/ui (Button), playback token hook helpers.
 * SideEffects: Invokes row action callbacks supplied by page hook.
 *
 * WHY CARDS AND NOT A TABLE
 * It was a 6-column table in `overflow-x-auto`. That kept the page from widening — the right
 * instinct — but on a phone the first two columns, Nama and Scope, sat off-screen. What was left
 * read as a wall of identical rows ("0 aktif - Unlimited", "TTL 60s") with the headings clipped
 * mid-word to "ESSION". The token's NAME, the one thing that tells two rows apart, was the part
 * you could not see, while "Cabut" and "Hapus" stayed in reach. That is a safety problem, not a
 * cosmetic one: the wrong click cuts off a real viewer.
 *
 * A card owns its own width, so the name leads and nothing is ever clipped. Rows are few (tens,
 * not thousands) and every one carries several actions, which is what cards are good at.
 */

import { Button } from '../../ui';
import { PLAYBACK_TOKEN_SESSION_LIMIT_MODES, formatPlaybackTokenSessionPolicy } from '../../../hooks/admin/usePlaybackTokenManagementPage.js';

function scopeLabel(token) {
    const count = token.allowed_camera_ids?.length || token.camera_ids?.length || token.camera_rules?.filter((rule) => rule.enabled !== false).length || 0;
    return token.scope_type === 'selected' ? `${count} kamera` : 'Semua kamera';
}

const FIELD = 'w-full rounded-control border border-edge-strong bg-surface px-3 py-2 text-sm text-content';

/**
 * SQL datetime ("2026-08-04 10:02:00") -> the "YYYY-MM-DDTHH:mm" that <input type="datetime-local">
 * requires. Handed the raw stored value the input silently renders blank, which reads as "no expiry
 * set" on a token that very much has one.
 */
function toDateTimeLocal(value) {
    if (!value) return '';
    const normalized = String(value).replace(' ', 'T');
    return normalized.slice(0, 16);
}

/** One label/value line. Fixed-width label so the values line up down the card. */
function Detail({ label, children }) {
    return (
        <div className="flex gap-3 text-sm">
            <dt className="w-24 shrink-0 text-content-subtle">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-content">{children}</dd>
        </div>
    );
}

function TokenEditFields({
    editForm, onUpdateEditForm, selectedEditCameraIds, visibleEditCameras, editCameraSearch,
    totalCameraCount, visibleEditCameraCount, onUpdateEditCameraSearch, onToggleEditCameraRule,
    onUpdateEditCameraRule, areaOptions = [], selectedEditAreaIds = new Set(), onToggleEditArea,
}) {
    return (
        <div className="space-y-3">
            <label className="block">
                <span className="mb-1 block text-xs font-semibold text-content-muted">Nama token</span>
                <input value={editForm.label} onChange={(event) => onUpdateEditForm('label', event.target.value)} className={FIELD} />
            </label>

            <label className="block">
                <span className="mb-1 block text-xs font-semibold text-content-muted">Akses kamera</span>
                {/*
                  * "Per area" was missing, so an area-scoped token opened its editor showing
                  * "Semua kamera" — a plain lie about what it covers, and one touch of the select
                  * would have converted it to all-cameras for real.
                  */}
                <select value={editForm.scope_type} onChange={(event) => onUpdateEditForm('scope_type', event.target.value)} className={FIELD}>
                    <option value="all">Semua kamera</option>
                    <option value="area">Per area</option>
                    <option value="selected">Kamera tertentu</option>
                </select>
            </label>

            {editForm.scope_type === 'area' && (
                <div className="space-y-2 rounded-card border border-edge p-2">
                    <p className="text-xs text-content-subtle">
                        Kamera yang ditambahkan ke area ini nanti otomatis ikut tercakup.
                    </p>
                    {areaOptions.length === 0 ? (
                        <p className="text-sm text-content-muted">Belum ada kamera yang punya area.</p>
                    ) : areaOptions.map((area) => (
                        <label key={area.id} className="flex items-center gap-2 rounded-control bg-surface-sunken p-2 text-sm text-content">
                            <input
                                type="checkbox"
                                checked={selectedEditAreaIds.has(area.id)}
                                onChange={() => onToggleEditArea?.(area.id)}
                            />
                            <span className="truncate">{area.name}</span>
                        </label>
                    ))}
                </div>
            )}

            {editForm.scope_type === 'selected' && (
                <div className="space-y-2 rounded-card border border-edge p-2">
                    <input
                        type="search"
                        value={editCameraSearch}
                        onChange={(event) => onUpdateEditCameraSearch?.(event.target.value)}
                        placeholder="Cari nama CCTV"
                        className={FIELD}
                    />
                    <p className="text-xs text-content-subtle">Menampilkan {visibleEditCameraCount} dari {totalCameraCount} CCTV</p>
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                        {visibleEditCameras.map((camera) => (
                            <div key={camera.id} className="rounded-control bg-surface-sunken p-2">
                                <label className="flex items-center gap-2 text-xs text-content">
                                    <input type="checkbox" checked={selectedEditCameraIds.has(camera.id)} onChange={() => onToggleEditCameraRule(camera.id)} />
                                    <span>{camera.name}</span>
                                </label>
                                {selectedEditCameraIds.has(camera.id) && (
                                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                                        <input type="number" min="1" placeholder="Maks. mundur (jam)" value={editForm.camera_rules[camera.id]?.playback_window_hours || ''} onChange={(event) => onUpdateEditCameraRule(camera.id, 'playback_window_hours', event.target.value)} className="rounded-control border border-edge-strong bg-surface px-2 py-1 text-xs text-content" />
                                        <input placeholder="Catatan" value={editForm.camera_rules[camera.id]?.note || ''} onChange={(event) => onUpdateEditCameraRule(camera.id, 'note', event.target.value)} className="rounded-control border border-edge-strong bg-surface px-2 py-1 text-xs text-content" />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/*
              * These two were in the payload the whole time but had no inputs, so the editor could
              * never change how far back a token reaches or when it stops working — the two things
              * most likely to need changing after a token is issued.
              */}
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-content-muted">Maksimal mundur (jam)</span>
                    <input type="number" min="1" value={editForm.playback_window_hours ?? ''} onChange={(event) => onUpdateEditForm('playback_window_hours', event.target.value)} placeholder="Kosong = semua rekaman" className={FIELD} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-content-muted">Berlaku sampai</span>
                    <input type="datetime-local" value={toDateTimeLocal(editForm.expires_at)} onChange={(event) => onUpdateEditForm('expires_at', event.target.value)} className={FIELD} />
                    <span className="mt-1 block text-xs text-content-subtle">Kosong = selamanya.</span>
                </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-content-muted">Maks. sesi</span>
                    <input type="number" min="0" value={editForm.max_active_sessions} onChange={(event) => onUpdateEditForm('max_active_sessions', event.target.value)} placeholder="Tanpa batas" className={FIELD} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-content-muted">Jika penuh</span>
                    <select value={editForm.session_limit_mode} onChange={(event) => onUpdateEditForm('session_limit_mode', event.target.value)} className={FIELD}>
                        {PLAYBACK_TOKEN_SESSION_LIMIT_MODES.filter((mode) => mode.value).map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                    </select>
                </label>
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-content-muted">Timeout (detik)</span>
                    <input type="number" min="30" max="3600" value={editForm.session_timeout_seconds} onChange={(event) => onUpdateEditForm('session_timeout_seconds', event.target.value)} className={FIELD} />
                </label>
            </div>

            <label className="block">
                <span className="mb-1 block text-xs font-semibold text-content-muted">Catatan (internal)</span>
                <input value={editForm.client_note ?? ''} onChange={(event) => onUpdateEditForm('client_note', event.target.value)} placeholder="Mis. nama pelanggan" className={FIELD} />
            </label>

            <label className="block">
                <span className="mb-1 block text-xs font-semibold text-content-muted">Template pesan share</span>
                {/* rows=5, not 3: at 3 the last line was sliced through its middle, which reads as a
                    rendering fault rather than as "scroll for more". */}
                <textarea rows={5} value={editForm.share_template} onChange={(event) => onUpdateEditForm('share_template', event.target.value)} className={`${FIELD} font-mono text-xs`} />
            </label>
        </div>
    );
}

function TokenCard({
    token, isEditing, editForm, updatingTokenId, sharingTokenId, deletingTokenId, formatTokenDate,
    onEdit, onCancelEdit, onUpdateToken, onRepeatShare, onClearSessions, onRevoke, onDelete,
    editFieldProps,
}) {
    const sessions = token.active_session_count || 0;

    return (
        <li className="rounded-card border border-edge bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    {/* The name leads and never truncates — it is the only thing distinguishing
                        one row from the next, and the reason the old table was unusable. */}
                    <h3 className="break-words text-sm font-semibold text-content">{token.label}</h3>
                    <p className="mt-0.5 font-mono text-xs text-content-subtle">{token.token_prefix}…</p>
                </div>
                {/*
                  * Nonaktif is `idle`, not `fault`. It used to be red, but a token the operator
                  * deliberately revoked is not a malfunction — reserving red for real faults is
                  * what keeps red meaning something.
                  */}
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
                    token.is_active ? 'bg-status-live/15 text-status-live' : 'bg-status-idle/15 text-status-idle'
                }`}>
                    {token.is_active ? 'Aktif' : 'Nonaktif'}
                </span>
            </div>

            <div className="mt-3 border-t border-edge pt-3">
                {isEditing ? (
                    <TokenEditFields editForm={editForm} {...editFieldProps} />
                ) : (
                    <dl className="space-y-1.5">
                        <Detail label="Akses">{scopeLabel(token)}</Detail>
                        {/* How far back this token may reach. Invisible before, so the only way to
                            know a token was capped to 1 hour was to open the edit form. */}
                        <Detail label="Maks. mundur">
                            {token.playback_window_hours ? `${token.playback_window_hours} jam terakhir` : 'Semua rekaman'}
                        </Detail>
                        <Detail label="Berlaku">{formatTokenDate(token.expires_at)}</Detail>
                        <Detail label="Sesi">{formatPlaybackTokenSessionPolicy(token)}</Detail>
                        <Detail label="Timeout">{token.session_timeout_seconds || 60} detik</Detail>
                    </dl>
                )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-edge pt-3">
                {isEditing ? (
                    <>
                        <Button size="sm" onClick={() => onUpdateToken(token.id)} loading={updatingTokenId === token.id} disabled={!editForm.label.trim()}>Simpan</Button>
                        <Button size="sm" variant="secondary" onClick={onCancelEdit}>Batal</Button>
                    </>
                ) : (
                    <>
                        {token.is_active && <Button size="sm" variant="secondary" onClick={() => onEdit(token)}>Edit</Button>}
                        {token.is_active && <Button size="sm" onClick={() => onRepeatShare(token.id)} loading={sharingTokenId === token.id}>Bagikan</Button>}
                        {token.is_active && sessions > 0 && <Button size="sm" variant="secondary" onClick={() => onClearSessions(token.id)}>Reset sesi ({sessions})</Button>}
                        {token.is_active && <Button size="sm" variant="dangerGhost" onClick={() => onRevoke(token.id)}>Cabut</Button>}
                        {/*
                          * Offered on EVERY card, active or not. A revoked token used to get no
                          * actions at all, which is how trial tokens became permanent debris.
                          * Deleting is the only thing left worth doing to a dead one.
                          */}
                        <Button size="sm" variant="danger" onClick={() => onDelete(token.id)} loading={deletingTokenId === token.id} className="ml-auto">Hapus</Button>
                    </>
                )}
            </div>
        </li>
    );
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
    onDelete,
    deletingTokenId = null,
    areaOptions = [],
    selectedEditAreaIds,
    onToggleEditArea,
}) {
    const editFieldProps = {
        onUpdateEditForm,
        selectedEditCameraIds,
        visibleEditCameras,
        editCameraSearch,
        totalCameraCount,
        visibleEditCameraCount,
        onUpdateEditCameraSearch,
        onToggleEditCameraRule,
        onUpdateEditCameraRule,
        areaOptions,
        selectedEditAreaIds,
        onToggleEditArea,
    };

    return (
        <div className="rounded-card border border-edge bg-surface-raised p-4 shadow-e1 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-content">Daftar Token</h2>
                <Button size="sm" variant="secondary" onClick={onRefresh}>Muat ulang</Button>
            </div>

            {loading ? (
                <div className="py-8 text-center text-sm text-content-muted">Memuat…</div>
            ) : tokens.length === 0 ? (
                <div className="rounded-card border border-edge bg-surface px-4 py-10 text-center text-sm text-content-muted">
                    Belum ada token playback.
                </div>
            ) : (
                <ul className="grid gap-3 xl:grid-cols-2">
                    {tokens.map((token) => (
                        <TokenCard
                            key={token.id}
                            token={token}
                            isEditing={editingTokenId === token.id}
                            editForm={editForm}
                            updatingTokenId={updatingTokenId}
                            sharingTokenId={sharingTokenId}
                            deletingTokenId={deletingTokenId}
                            formatTokenDate={formatTokenDate}
                            onEdit={onEdit}
                            onCancelEdit={onCancelEdit}
                            onUpdateToken={onUpdateToken}
                            onRepeatShare={onRepeatShare}
                            onClearSessions={onClearSessions}
                            onRevoke={onRevoke}
                            onDelete={onDelete}
                            editFieldProps={editFieldProps}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}
