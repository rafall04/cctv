/*
 * Purpose: Show the playback-token audit trail with the detail that was already being recorded —
 *          which device, and why an attempt failed.
 * Caller: pages/PlaybackTokenManagement.jsx.
 * Deps: components/ui (Button), utils/admin/deviceLabel.
 * MainFuncs: PlaybackTokenAuditLog.
 * SideEffects: None; renders props and calls the supplied filter/limit callbacks.
 *
 * WHAT WAS MISSING
 * The API already sent `user_agent` and `detail_json` for every entry; the old table rendered
 * neither. Two consequences:
 *   - A shared token is one code held by many people, so the DEVICE is the only thing separating
 *     one viewer from another. Without it, sixty activations could be one person reloading or
 *     fifteen people, and the log could not tell you which.
 *   - `activation_failed` carries `{"reason": "..."}` — the single line someone wants when a
 *     viewer says "it will not let me in" — and it was thrown away. Worse, a failure rendered
 *     with exactly the weight of a success, so it did not even stand out.
 *
 * It was also a 5-column table in `overflow-x-auto`, so time, event, token, camera and IP could
 * never be read together: scrolling to see the IP pushed the time off-screen. Cards end that.
 */

import { Button } from '../../ui';
import { summarizeUserAgent } from '../../../utils/admin/deviceLabel.js';

/**
 * Event names as stored, and how they read to a person. `tone` decides the badge colour: `fault` is
 * reserved for an attempt that actually failed, so red keeps meaning something.
 */
const EVENTS = {
    created: { label: 'Token dibuat', tone: 'info' },
    updated: { label: 'Token diubah', tone: 'info' },
    shared: { label: 'Teks share dibuat', tone: 'info' },
    revoked: { label: 'Token dicabut', tone: 'warn' },
    activated_token: { label: 'Masuk pakai kode', tone: 'ok' },
    activated_share: { label: 'Masuk pakai tautan', tone: 'ok' },
    activation_failed: { label: 'Gagal masuk', tone: 'fault' },
    session_started: { label: 'Sesi dimulai', tone: 'ok' },
    sessions_cleared: { label: 'Sesi direset', tone: 'warn' },
    access_segments: { label: 'Buka daftar rekaman', tone: 'ok' },
    access_playlist: { label: 'Buka playlist', tone: 'ok' },
};

const TONE_CLASS = {
    ok: 'bg-status-live/15 text-status-live',
    info: 'bg-surface-sunken text-content-muted',
    warn: 'bg-status-warn/15 text-status-warn',
    fault: 'bg-status-fault/15 text-status-fault',
};

function describeEvent(eventType) {
    // Unknown events keep their raw name rather than being hidden — a log that silently drops
    // entries it does not recognise is worse than one showing a name you have to look up.
    return EVENTS[eventType] || { label: eventType, tone: 'info' };
}

/**
 * The parts of detail_json worth showing, in plain words. Everything else is dropped: raw JSON in a
 * log row is noise, and the fields that matter differ per event.
 */
function describeDetail(log) {
    let detail = {};
    try {
        detail = typeof log.detail_json === 'string' ? JSON.parse(log.detail_json || '{}') : (log.detail_json || {});
    } catch {
        return null;
    }

    // The reason a login failed is the whole point of the entry.
    if (detail.reason) return detail.reason;

    const bits = [];
    if (detail.preset) bits.push(`preset ${detail.preset}`);
    if (Number.isFinite(detail.camera_count) && detail.camera_count > 0) bits.push(`${detail.camera_count} kamera`);
    if (detail.share_key_prefix) bits.push(`kunci ${detail.share_key_prefix}${detail.reused ? ' (dipakai ulang)' : ' (baru)'}`);
    if (Number.isFinite(detail.cleared)) bits.push(`${detail.cleared} sesi dihentikan`);
    if (detail.timeout_seconds) {
        const limit = detail.max_active_sessions ? `maks ${detail.max_active_sessions} sesi` : 'tanpa batas sesi';
        bits.push(`${limit}, timeout ${detail.timeout_seconds}s`);
    }
    return bits.length ? bits.join(' · ') : null;
}

/** One label/value line, only rendered when there is a value — no row of dashes. */
function Line({ label, children }) {
    if (!children) return null;
    return (
        <div className="flex gap-3 text-xs">
            <dt className="w-20 shrink-0 text-content-subtle">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-content-muted">{children}</dd>
        </div>
    );
}

function LogCard({ log, formatTokenDate }) {
    const event = describeEvent(log.event_type);
    const device = summarizeUserAgent(log.user_agent);
    const detail = describeDetail(log);
    const isFault = event.tone === 'fault';

    return (
        <li className={`rounded-card border p-3 ${isFault ? 'border-status-fault/40 bg-status-fault/5' : 'border-edge bg-surface'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs tabular-nums text-content-muted">{formatTokenDate(log.created_at)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[event.tone]}`}>
                    {event.label}
                </span>
            </div>

            {/* The reason a failure happened leads, because it is why anyone opens this log. */}
            {detail && (
                <p className={`mt-2 text-xs ${isFault ? 'font-medium text-status-fault' : 'text-content-muted'}`}>{detail}</p>
            )}

            <dl className="mt-2 space-y-1">
                <Line label="Token">
                    {log.token_label
                        ? <>{log.token_label} <span className="font-mono text-content-subtle">{log.token_prefix}</span></>
                        : <span className="italic">token sudah dihapus</span>}
                </Line>
                <Line label="Kamera">{log.camera_name || (log.camera_id ? `ID ${log.camera_id}` : null)}</Line>
                {/* The one field that separates two viewers holding the same shared code. */}
                <Line label="Perangkat">{device}</Line>
                <Line label="IP">{log.ip_address ? <span className="font-mono">{log.ip_address}</span> : null}</Line>
                {/* Only staff actions carry an actor; public viewers have no account, so the old
                    table printed a dash on every single row for no information at all. */}
                <Line label="Oleh">{log.actor_username}</Line>
            </dl>
        </li>
    );
}

export default function PlaybackTokenAuditLog({
    logs = [],
    tokens = [],
    formatTokenDate,
    filterTokenId = '',
    onFilterTokenId,
    onShowMore,
    canShowMore = false,
}) {
    return (
        <div className="rounded-card border border-edge bg-surface-raised p-4 shadow-e1 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-content">Log Aktivitas Token</h2>
                {/* The backend has always supported filtering by token; the page just never asked. */}
                {/* Both min-w-0s are load-bearing: a <select> is sized by its widest <option> —
                  * a token label here — and `max-w-44` is 11rem, i.e. 264px once Android's 1.5x
                  * font scale moves the root to 24px. Without them the pair refuses to shrink and
                  * the card is 372px wide inside a 320px phone. */}
                <label className="flex min-w-0 items-center gap-2 text-xs text-content-muted">
                    Token
                    <select
                        value={filterTokenId}
                        onChange={(event) => onFilterTokenId?.(event.target.value)}
                        className="min-w-0 max-w-44 rounded-control border border-edge bg-surface px-2 py-1 text-xs text-content"
                    >
                        <option value="">Semua token</option>
                        {tokens.map((token) => (
                            <option key={token.id} value={token.id}>{token.label}</option>
                        ))}
                    </select>
                </label>
            </div>

            {logs.length === 0 ? (
                <div className="rounded-card border border-edge bg-surface px-4 py-10 text-center text-sm text-content-muted">
                    Belum ada aktivitas untuk pilihan ini.
                </div>
            ) : (
                <>
                    <ul className="space-y-2">
                        {logs.map((log) => (
                            <LogCard key={log.id} log={log} formatTokenDate={formatTokenDate} />
                        ))}
                    </ul>
                    {/* Wraps: Button's label span is `truncate`, i.e. white-space:nowrap, so the
                      * button's min-content is the WHOLE label — 236px at the Android 1.5x font
                      * scale, which does not share a 320px row with the count. */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="min-w-0 font-mono text-xs tabular-nums text-content-subtle">{logs.length} aktivitas</p>
                        {canShowMore && (
                            <Button size="sm" variant="secondary" onClick={onShowMore}>
                                Tampilkan lebih banyak
                            </Button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
