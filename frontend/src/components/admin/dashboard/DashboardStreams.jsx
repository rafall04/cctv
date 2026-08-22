/*
Purpose: Stream ranking, stream table, stream drawer, and viewer-session modal for the admin dashboard.
Caller: pages/Dashboard.jsx.
Deps: components/ui (Modal, DataTable, Badge, Button), ../../ui/EmptyState, hooks/useFocusTrap.
MainFuncs: rankDashboardStreams, DashboardStreamsPanel, StreamsDrawer, ViewerSessionsModal.
SideEffects: Opens modal/drawer callbacks supplied by the parent page; traps focus while open.

Chrome removed in the 2026-07 admin pass, and why:
  - rounded-[28px] + backdrop-blur-xl + shadow-[0_24px_60px_...] on the panel: a one-off radius, a
    one-off shadow and a blur that costs a compositor layer on every scroll frame.
  - hover:-translate-y-0.5 on rows and buttons: a hover that moves layout, on a table an operator
    scans with the pointer.
  - amber gradient rank medals and purple viewer chips: neither colour is in the token set, and the
    viewer count is the same quantity the public surface renders in the cyan `data` accent.
*/

import { useRef } from 'react';
import { NoStreamsEmptyState } from '../../ui/EmptyState';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { Modal } from '../../ui/Modal';
import { Badge } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { Table, TableShell, THead, TBody, TR, TH, TD } from '../../ui/DataTable';

function getStreamPriorityScore(stream) {
    const viewerScore = (stream.viewers || 0) * 100;
    const operationalPenalty = stream.operationalState === 'online' ? 0 : 40;
    const stateBonus = stream.state === 'buffering'
        ? 45
        : stream.state === 'offline'
            ? 35
            : stream.state === 'maintenance'
                ? 30
                : 0;
    return viewerScore + operationalPenalty + stateBonus;
}

export function rankDashboardStreams(streams = []) {
    return [...streams].sort((left, right) => {
        const scoreDiff = getStreamPriorityScore(right) - getStreamPriorityScore(left);
        if (scoreDiff !== 0) {
            return scoreDiff;
        }

        const viewerDiff = (right.viewers || 0) - (left.viewers || 0);
        if (viewerDiff !== 0) {
            return viewerDiff;
        }

        return String(left.name || '').localeCompare(String(right.name || ''));
    });
}

function formatDuration(seconds) {
    if (!seconds || seconds < 60) return `${seconds || 0}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    return `${hours}j ${mins % 60}m`;
}

function DeviceIcon({ type }) {
    const paths = {
        mobile: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
        tablet: 'M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z',
    };
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={paths[type] || 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'}
            />
        </svg>
    );
}

export function ViewerSessionsModal({ title, sessions, onClose }) {
    return (
        <Modal title={title} description={`${sessions.length} viewer aktif`} onClose={onClose} size="md">
            {sessions.length === 0 ? (
                <p className="py-8 text-center text-sm text-content-muted">Tidak ada viewer aktif</p>
            ) : (
                <ul className="divide-y divide-edge">
                    {sessions.map((session, idx) => (
                        <li key={session.sessionId || idx} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-content-muted">
                                <DeviceIcon type={session.deviceType} />
                            </span>

                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-sm font-semibold tabular-nums text-content">
                                        {session.ipAddress}
                                    </span>
                                    <Badge tone="neutral">{session.deviceType || 'desktop'}</Badge>
                                </div>
                                {session.cameraName && (
                                    <p className="mt-0.5 truncate text-xs text-content-muted">Kamera {session.cameraName}</p>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-content-muted">
                                    <span>{formatDuration(session.durationSeconds)}</span>
                                    {session.startedAt && (
                                        <span>
                                            Mulai {new Date(session.startedAt).toLocaleTimeString('id-ID', {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <Badge tone="live" dot className="shrink-0">LIVE</Badge>
                        </li>
                    ))}
                </ul>
            )}
        </Modal>
    );
}

/** Viewer count: cyan `data`, matching how the public surface renders the same quantity. */
function StreamViewerButton({ stream, onOpen }) {
    const hasViewers = stream.viewers > 0;

    return (
        <button
            type="button"
            onClick={() => onOpen({ title: `Viewer ${stream.name}`, sessions: stream.sessions || [] })}
            aria-label={`Lihat ${stream.viewers} viewer di ${stream.name}`}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 font-mono text-sm font-semibold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-h-8 ${
                hasViewers ? 'bg-data/10 text-data hover:bg-data/20' : 'bg-surface-sunken text-content-muted hover:bg-surface-raised'
            }`}
        >
            <span className={`h-1.5 w-1.5 rounded-full ${hasViewers ? 'bg-data' : 'bg-status-idle'}`} aria-hidden="true" />
            {stream.viewers}
        </button>
    );
}

function ActiveStreamRow({ stream, formatBytes, getOperationalTone, getStreamTransportTone, onOpenViewer }) {
    return (
        <div className="flex items-center gap-3 rounded-card border border-edge bg-surface p-3 transition-colors hover:border-edge-strong">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-content-muted">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            </span>

            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-content">{stream.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getOperationalTone(stream.operationalState)}`}>
                        {stream.operationalState || 'offline'}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getStreamTransportTone(stream.state)}`}>
                        {stream.state}
                    </span>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <StreamViewerButton stream={stream} onOpen={onOpenViewer} />
                <div className="text-right font-mono text-xs tabular-nums">
                    <p className="font-semibold text-content">↑{formatBytes(stream.bytesSent)}</p>
                    <p className="text-content-subtle">↓{formatBytes(stream.bytesReceived)}</p>
                </div>
            </div>
        </div>
    );
}

const CloseIcon = () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);

export function StreamsDrawer({ open, streams, onClose, formatBytes, getOperationalTone, getStreamTransportTone, onOpenViewer }) {
    const panelRef = useRef(null);
    useFocusTrap(panelRef, { active: open, onEscape: onClose });

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-modal flex justify-end bg-black/60" onClick={onClose}>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Semua stream aktif"
                className="flex h-full w-full max-w-2xl flex-col border-l border-edge bg-surface-overlay shadow-e2"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-edge px-4 py-3">
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-content">Semua stream aktif</h2>
                        <p className="mt-1 text-xs text-content-muted">
                            {streams.length} stream diprioritaskan berdasarkan viewer dan kondisi operasional.
                        </p>
                    </div>
                    <IconButton label="Tutup daftar stream" size="sm" onClick={onClose} className="-mr-2 -mt-1">
                        <CloseIcon />
                    </IconButton>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-4">
                    {streams.map((stream) => (
                        <ActiveStreamRow
                            key={stream.id}
                            stream={stream}
                            formatBytes={formatBytes}
                            getOperationalTone={getOperationalTone}
                            getStreamTransportTone={getStreamTransportTone}
                            onOpenViewer={onOpenViewer}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function DashboardStreamTableRow({ stream, index, formatBytes, getOperationalTone, getStreamTransportTone, onOpenViewer }) {
    const rank = index < 3 && stream.viewers > 0 ? index + 1 : null;

    return (
        <TR interactive>
            <TD>
                <div className="flex items-center gap-2.5">
                    {/* Rank is data, not a medal — no gradient, no coloured drop shadow. */}
                    <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-content-subtle">
                        {rank ? `#${rank}` : ''}
                    </span>
                    <div className="min-w-0">
                        <p className="truncate font-semibold text-content">{stream.name}</p>
                        <p className="font-mono text-xs tabular-nums text-content-subtle">ID {stream.id}</p>
                    </div>
                </div>
            </TD>
            <TD>
                <div className="flex flex-wrap gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getOperationalTone(stream.operationalState)}`}>
                        {stream.operationalState || 'offline'}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getStreamTransportTone(stream.state)}`}>
                        {stream.state}
                    </span>
                </div>
            </TD>
            <TD align="right">
                <StreamViewerButton stream={stream} onOpen={onOpenViewer} />
            </TD>
            <TD align="right" mono>
                <p className="font-semibold text-content">↑{formatBytes(stream.bytesSent)}</p>
                <p className="text-xs text-content-subtle">↓{formatBytes(stream.bytesReceived)}</p>
            </TD>
        </TR>
    );
}

function StreamsUnavailable({ onRetry }) {
    return (
        <TR>
            <TD colSpan="4" className="py-12 text-center">
                <div className="flex flex-col items-center gap-2">
                    <span className="flex h-12 w-12 items-center justify-center rounded-card bg-status-fault/10 text-status-fault">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </span>
                    <p className="font-semibold text-content">Media server offline</p>
                    <p className="text-sm text-content-muted">Statistik transport stream belum tersedia</p>
                    <Button size="sm" onClick={onRetry} className="mt-2">Coba lagi</Button>
                </div>
            </TD>
        </TR>
    );
}

export function DashboardStreamsPanel({
    stats,
    rankedStreams,
    visibleStreams,
    overflowStreamCount,
    formatBytes,
    getOperationalTone,
    getStreamTransportTone,
    onOpenViewer,
    onOpenDrawer,
    onAddCamera,
    onRetry,
}) {
    return (
        <div className="space-y-3 xl:col-span-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-base font-semibold text-content">Stream Aktif</h2>
                    <p className="mt-0.5 text-xs text-content-muted">Top 8 stream paling penting untuk dipantau cepat.</p>
                </div>
                {rankedStreams.length > 0 && (
                    <Button
                        size="sm"
                        data-testid="open-streams-drawer"
                        onClick={onOpenDrawer}
                        iconRight={overflowStreamCount > 0 ? <Badge tone="neutral" mono>+{overflowStreamCount}</Badge> : null}
                    >
                        Lihat semua stream
                    </Button>
                )}
            </div>

            <TableShell data-testid="dashboard-streams-panel">
                <Table>
                    <THead>
                        <TR>
                            <TH>Kamera</TH>
                            <TH>Status</TH>
                            <TH align="right">Viewer</TH>
                            <TH align="right">Bandwidth</TH>
                        </TR>
                    </THead>
                    <TBody>
                        {!stats?.mtxConnected ? (
                            <StreamsUnavailable onRetry={onRetry} />
                        ) : stats?.streams.length === 0 ? (
                            <TR>
                                <TD colSpan="4" className="py-8">
                                    <NoStreamsEmptyState onAddCamera={onAddCamera} />
                                </TD>
                            </TR>
                        ) : (
                            visibleStreams.map((stream, index) => (
                                <DashboardStreamTableRow
                                    key={stream.id}
                                    stream={stream}
                                    index={index}
                                    formatBytes={formatBytes}
                                    getOperationalTone={getOperationalTone}
                                    getStreamTransportTone={getStreamTransportTone}
                                    onOpenViewer={onOpenViewer}
                                />
                            ))
                        )}
                    </TBody>
                </Table>
            </TableShell>
        </div>
    );
}
