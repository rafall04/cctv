/*
Purpose: Stream ranking, stream table, stream drawer, and viewer-session modal for the admin dashboard.
Caller: pages/Dashboard.jsx.
Deps: ../../ui/EmptyState.
MainFuncs: rankDashboardStreams, DashboardStreamsPanel, StreamsDrawer, ViewerSessionsModal.
SideEffects: Opens modal/drawer callbacks supplied by the parent page.
*/

import { NoStreamsEmptyState } from '../../ui/EmptyState';

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
    return `${hours}h ${mins % 60}m`;
}

function DeviceIcon({ type }) {
    if (type === 'mobile') {
        return (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
        );
    }

    if (type === 'tablet') {
        return (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
        );
    }

    return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
    );
}

export function ViewerSessionsModal({ title, sessions, onClose }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
            <div
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 dark:bg-purple-500/20 rounded-xl flex items-center justify-center text-purple-500">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-900 dark:text-white">{title}</h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{sessions.length} viewer aktif</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                        <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="overflow-y-auto max-h-[60vh]">
                    {sessions.length === 0 ? (
                        <div className="p-8 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                                <svg className="w-8 h-8 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            </div>
                            <p className="text-gray-500 dark:text-gray-400">Tidak ada viewer aktif</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-800">
                            {sessions.map((session, idx) => (
                                <div key={session.sessionId || idx} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                            session.deviceType === 'mobile' ? 'bg-blue-100 dark:bg-primary/20 text-primary' :
                                                session.deviceType === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-500' :
                                                    'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                        }`}>
                                            <DeviceIcon type={session.deviceType} />
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">
                                                    {session.ipAddress}
                                                </span>
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                    session.deviceType === 'mobile' ? 'bg-blue-100 dark:bg-primary/20 text-primary-600 dark:text-blue-400' :
                                                        session.deviceType === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400' :
                                                            'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                                }`}>
                                                    {session.deviceType || 'desktop'}
                                                </span>
                                            </div>
                                            {session.cameraName && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Camera {session.cameraName}</p>
                                            )}
                                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                <span>{formatDuration(session.durationSeconds)}</span>
                                                {session.startedAt && (
                                                    <span>
                                                        Mulai: {new Date(session.startedAt).toLocaleTimeString('id-ID', {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">LIVE</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StreamStatePill({ children, tone }) {
    return (
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${tone}`}>
            {children}
        </span>
    );
}

function StreamViewerButton({ stream, onOpen }) {
    const hasViewers = stream.viewers > 0;

    return (
        <button
            onClick={() => onOpen({
                title: `Viewer ${stream.name}`,
                sessions: stream.sessions || [],
            })}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                hasViewers
                    ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:hover:bg-purple-500/30'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
            title="Klik untuk lihat detail viewer"
        >
            <span className={`h-1.5 w-1.5 rounded-full ${hasViewers ? 'bg-purple-500 animate-pulse' : 'bg-gray-400'}`}></span>
            {stream.viewers}
        </button>
    );
}

function ActiveStreamRow({ stream, formatBytes, getOperationalTone, getStreamTransportTone, onOpenViewer }) {
    const isHot = (stream.viewers || 0) > 0;

    return (
        <div className="flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white/80 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md dark:border-gray-700/60 dark:bg-gray-900/30">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                isHot
                    ? 'bg-gradient-to-br from-primary to-sky-600 text-white shadow-lg shadow-primary/20'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300'
            }`}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{stream.name}</p>
                    {isHot && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary dark:bg-primary/20 dark:text-sky-300">
                            Hot
                        </span>
                    )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StreamStatePill tone={getOperationalTone(stream.operationalState)}>
                        {stream.operationalState || 'offline'}
                    </StreamStatePill>
                    <StreamStatePill tone={getStreamTransportTone(stream.state)}>
                        {stream.state}
                    </StreamStatePill>
                </div>
            </div>

            <div className="shrink-0 text-right">
                <div className="flex items-center justify-end gap-2">
                    <StreamViewerButton stream={stream} onOpen={onOpenViewer} />
                    <div>
                        <p className="text-sm font-semibold text-primary dark:text-sky-300">{formatBytes(stream.bytesSent)}</p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">{formatBytes(stream.bytesReceived)}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function StreamsDrawer({ open, streams, onClose, formatBytes, getOperationalTone, getStreamTransportTone, onOpenViewer }) {
    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-sm" onClick={onClose}>
            <div
                className="flex h-full w-full max-w-2xl flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary dark:text-sky-300">Stream Detail</p>
                        <h3 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">Semua stream aktif</h3>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{streams.length} stream diprioritaskan berdasarkan viewer dan kondisi operasional.</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                    >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-5">
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
    const isTop3 = index < 3 && stream.viewers > 0;
    const rankBadge = index === 0 ? '#1' : index === 1 ? '#2' : index === 2 ? '#3' : null;

    return (
        <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
            <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                    {isTop3 && (
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-300" title={`Rank #${index + 1}`}>
                            {rankBadge}
                        </span>
                    )}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        isTop3
                            ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30'
                            : 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400'
                    }`}>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{stream.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">ID: {stream.id}</p>
                    </div>
                </div>
            </td>
            <td className="px-6 py-4">
                <div className="flex flex-wrap gap-2">
                    <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${getOperationalTone(stream.operationalState)}`}>
                        Operasional: {stream.operationalState || 'offline'}
                    </span>
                    <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${getStreamTransportTone(stream.state)}`}>
                        Transport: {stream.state}
                    </span>
                </div>
            </td>
            <td className="px-6 py-4 text-center">
                <button
                    onClick={() => onOpenViewer({
                        title: `Viewer ${stream.name}`,
                        sessions: stream.sessions || [],
                    })}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                        stream.viewers > 0
                            ? 'bg-purple-100 dark:bg-purple-500/20 hover:bg-purple-200 dark:hover:bg-purple-500/30'
                            : 'bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title="Klik untuk lihat detail viewer"
                >
                    <span className={`w-1.5 h-1.5 rounded-full ${stream.viewers > 0 ? 'bg-purple-500 animate-pulse' : 'bg-gray-400'}`}></span>
                    <span className={`text-sm font-semibold ${
                        stream.viewers > 0
                            ? 'text-purple-600 dark:text-purple-400'
                            : 'text-gray-600 dark:text-gray-400'
                    }`}>
                        {stream.viewers}
                    </span>
                </button>
            </td>
            <td className="px-6 py-4 text-right">
                <p className="text-sm font-semibold text-primary">Up {formatBytes(stream.bytesSent)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Down {formatBytes(stream.bytesReceived)}</p>
            </td>
        </tr>
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
        <div className="xl:col-span-2 space-y-4">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Stream Aktif</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Top 8 stream paling penting untuk dipantau cepat.</p>
                </div>
                {rankedStreams.length > 0 && (
                    <button
                        type="button"
                        data-testid="open-streams-drawer"
                        onClick={onOpenDrawer}
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:text-primary dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-primary/40 dark:hover:text-sky-300"
                    >
                        Lihat semua stream
                        {overflowStreamCount > 0 && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary dark:bg-primary/20 dark:text-sky-300">
                                +{overflowStreamCount}
                            </span>
                        )}
                    </button>
                )}
            </div>
            <div data-testid="dashboard-streams-panel" className="rounded-[28px] border border-white/55 bg-white/75 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/50">
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Camera</th>
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-4 text-center text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Viewers</th>
                                <th className="px-6 py-4 text-right text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Bandwidth</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700/50">
                            {!stats?.mtxConnected ? (
                                <tr>
                                    <td colSpan="4" className="px-6 py-16 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-14 h-14 bg-red-100 dark:bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
                                                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                </svg>
                                            </div>
                                            <p className="font-semibold text-gray-900 dark:text-white">Media server offline</p>
                                            <p className="text-sm text-gray-500 dark:text-gray-400">Statistik transport stream belum tersedia</p>
                                            <button
                                                onClick={onRetry}
                                                className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary-600 hover:text-sky-700 dark:text-primary-400 dark:hover:text-sky-300 transition-colors"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                                Coba lagi
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ) : stats?.streams.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="px-6 py-8">
                                        <NoStreamsEmptyState onAddCamera={onAddCamera} />
                                    </td>
                                </tr>
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
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
