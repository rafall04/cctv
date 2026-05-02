import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AnalyticsHistoryTable, { AnalyticsHistoryDrawer, renderDeviceBadge, renderDurationText } from '../components/admin/analytics/AnalyticsHistoryTable';
import { AnalyticsTabNav, AnalyticsWorkspaceHeader } from '../components/admin/analytics/AnalyticsWorkspace';
import { formatWatchTime } from '../components/admin/analytics/AnalyticsPrimitives';
import { adminService } from '../services/adminService';
import { cameraService } from '../services/cameraService';
import { REQUEST_POLICY } from '../services/requestPolicy';
import { exportToCSV, mapPeriodToApi } from '../utils/admin/viewerAnalyticsAdapter';
import { useAdminReconnectRefresh } from '../hooks/admin/useAdminReconnectRefresh';

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'active', label: 'Active' },
    { id: 'history', label: 'History' },
    { id: 'top', label: 'Top' },
    { id: 'audience', label: 'Audience' },
];

const PERIOD_OPTIONS = [
    { value: 'today', label: 'Hari Ini' },
    { value: 'yesterday', label: 'Kemarin' },
    { value: '7days', label: '7 Hari' },
    { value: '30days', label: '30 Hari' },
    { value: 'all', label: 'Semua' },
];

const ACCESS_MODE_OPTIONS = [
    { value: '', label: 'Semua Akses' },
    { value: 'public_preview', label: 'Preview Publik' },
    { value: 'admin_full', label: 'Admin Full' },
];

const SORT_OPTIONS = [
    { value: 'started_at:desc', label: 'Terbaru' },
    { value: 'started_at:asc', label: 'Terlama' },
    { value: 'duration_seconds:desc', label: 'Durasi Terpanjang' },
    { value: 'camera_name:asc', label: 'Kamera A-Z' },
];

function StatCard({ label, value, tone = 'blue' }) {
    const tones = {
        blue: 'from-blue-500/10 to-cyan-500/10 border-blue-200 dark:border-blue-900/60',
        emerald: 'from-emerald-500/10 to-teal-500/10 border-emerald-200 dark:border-emerald-900/60',
        amber: 'from-amber-500/10 to-orange-500/10 border-amber-200 dark:border-amber-900/60',
        violet: 'from-violet-500/10 to-fuchsia-500/10 border-violet-200 dark:border-violet-900/60',
    };

    return (
        <div className={`rounded-2xl border bg-gradient-to-br ${tones[tone]} bg-white p-5 dark:bg-gray-900`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
        </div>
    );
}

function SectionCard({ title, children }) {
    return (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
            <div className="mt-4">{children}</div>
        </section>
    );
}

function renderPlaybackHistoryCell(session, column) {
    switch (column.key) {
        case 'camera_name':
            return (
                <div>
                    <div className="font-semibold text-gray-900 dark:text-white">{session.camera_name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{session.segment_filename}</div>
                </div>
            );
        case 'playback_access_mode':
            return (
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    {session.playback_access_mode}
                </span>
            );
        case 'viewer':
            return (
                <div>
                    <div className="font-mono text-xs">{session.ip_address}</div>
                    {session.admin_username && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{session.admin_username}</div>
                    )}
                </div>
            );
        case 'device_type':
            return renderDeviceBadge(session.device_type);
        case 'started_at':
            return new Date(session.started_at).toLocaleString('id-ID');
        case 'duration_seconds':
            return renderDurationText(session.duration_seconds);
        default:
            return session[column.key] ?? '-';
    }
}

export default function PlaybackAnalytics() {
    const [activeTab, setActiveTab] = useState('overview');
    const [period, setPeriod] = useState('7days');
    const [cameraId, setCameraId] = useState('');
    const [accessMode, setAccessMode] = useState('');
    const [analytics, setAnalytics] = useState(null);
    const [activeSessions, setActiveSessions] = useState([]);
    const [cameraOptions, setCameraOptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastUpdate, setLastUpdate] = useState(null);
    const [history, setHistory] = useState({ items: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 }, summary: { totalItems: 0, uniqueViewers: 0, totalWatchTime: 0 } });
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState('');
    const [historyDeviceType, setHistoryDeviceType] = useState('');
    const [historySearch, setHistorySearch] = useState('');
    const [historySort, setHistorySort] = useState('started_at:desc');
    const [selectedHistorySession, setSelectedHistorySession] = useState(null);
    const requestIdRef = useRef(0);
    const historyRequestIdRef = useRef(0);

    const loadAnalytics = useCallback(async (mode = 'initial') => {
        const isBackground = mode !== 'initial';
        const requestId = ++requestIdRef.current;
        const query = {
            cameraId: cameraId || undefined,
            accessMode: accessMode || undefined,
        };

        try {
            const [analyticsResponse, activeResponse] = await Promise.all([
                adminService.getPlaybackViewerAnalytics(
                    period,
                    query,
                    isBackground ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING
                ),
                adminService.getPlaybackViewerActive(
                    query,
                    isBackground ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING
                ),
            ]);

            if (requestId !== requestIdRef.current) {
                return;
            }

            if (!analyticsResponse.success) {
                throw new Error(analyticsResponse.message || 'Gagal memuat playback analytics');
            }

            setAnalytics(analyticsResponse.data);
            setActiveSessions(activeResponse.success ? activeResponse.data.sessions || [] : []);
            setError('');
            setLastUpdate(new Date());
        } catch (loadError) {
            if (requestId !== requestIdRef.current) {
                return;
            }
            setError(loadError.message || 'Gagal memuat playback analytics');
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    }, [accessMode, cameraId, period]);

    const loadHistory = useCallback(async ({
        page = history.pagination.page,
        pageSize = history.pagination.pageSize,
    } = {}) => {
        const requestId = ++historyRequestIdRef.current;
        setHistoryLoading(true);
        const [sortBy, sortDirection] = historySort.split(':');

        try {
            const response = await adminService.getPlaybackViewerHistory({
                period: mapPeriodToApi(period, ''),
                page,
                pageSize,
                cameraId: cameraId || undefined,
                accessMode: accessMode || undefined,
                deviceType: historyDeviceType || undefined,
                search: historySearch || undefined,
                sortBy,
                sortDirection,
            }, REQUEST_POLICY.BLOCKING);

            if (requestId !== historyRequestIdRef.current) {
                return;
            }

            if (!response.success) {
                throw new Error(response.message || 'Gagal memuat riwayat playback');
            }

            setHistory(response.data);
            setHistoryError('');
        } catch (loadError) {
            if (requestId !== historyRequestIdRef.current) {
                return;
            }
            setHistoryError(loadError.message || 'Gagal memuat riwayat playback');
        } finally {
            if (requestId === historyRequestIdRef.current) {
                setHistoryLoading(false);
            }
        }
    }, [accessMode, cameraId, history.pagination.page, history.pagination.pageSize, historyDeviceType, historySearch, historySort, period]);

    useEffect(() => {
        let isMounted = true;

        const loadCameras = async () => {
            try {
                const response = await cameraService.getAllCameras(REQUEST_POLICY.BLOCKING);
                if (!isMounted || !response.success) {
                    return;
                }

                const cameras = (response.data || [])
                    .filter((camera) => camera.enable_recording)
                    .map((camera) => ({
                        id: camera.id,
                        name: camera.name,
                    }));
                setCameraOptions(cameras);
            } catch (cameraError) {
                console.error('Load playback analytics cameras error:', cameraError);
            }
        };

        loadCameras();
        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        setLoading(true);
        loadAnalytics('initial');
    }, [loadAnalytics]);

    useEffect(() => {
        loadHistory({ page: 1, pageSize: history.pagination.pageSize });
    }, [loadHistory, history.pagination.pageSize]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            loadAnalytics('background');
        }, 30000);

        return () => clearInterval(intervalId);
    }, [loadAnalytics]);

    useAdminReconnectRefresh(() => loadAnalytics('resume'));

    const accessBreakdown = useMemo(() => analytics?.accessBreakdown || [], [analytics?.accessBreakdown]);
    const topCameras = analytics?.topCameras || [];
    const topSegments = analytics?.topSegments || [];
    const topViewers = analytics?.topViewers || [];
    const deviceBreakdown = analytics?.deviceBreakdown || [];
    const recentSessions = useMemo(() => (analytics?.recentSessions || []).slice(0, 5), [analytics?.recentSessions]);
    const overview = analytics?.overview || {};
    const breakdownMap = useMemo(() => {
        return accessBreakdown.reduce((accumulator, item) => {
            accumulator[item.playback_access_mode] = item.count;
            return accumulator;
        }, {});
    }, [accessBreakdown]);
    const activeByAccess = useMemo(() => {
        return activeSessions.reduce((accumulator, session) => {
            const key = session.playback_access_mode || session.playbackAccessMode || 'public_preview';
            accumulator[key] = (accumulator[key] || 0) + 1;
            return accumulator;
        }, {});
    }, [activeSessions]);

    return (
        <div className="space-y-6">
            <AnalyticsHistoryDrawer
                open={Boolean(selectedHistorySession)}
                session={selectedHistorySession}
                title="Detail Sesi Playback"
                onClose={() => setSelectedHistorySession(null)}
                fields={[
                    { label: 'Kamera', key: 'camera_name' },
                    { label: 'Segment', key: 'segment_filename' },
                    { label: 'Mode Akses', key: 'playback_access_mode' },
                    { label: 'Viewer / IP', key: 'ip_address' },
                    { label: 'Admin', key: 'admin_username' },
                    { label: 'Device', key: 'device_type' },
                    { label: 'Mulai', render: (session) => new Date(session.started_at).toLocaleString('id-ID') },
                    { label: 'Selesai', render: (session) => session.ended_at ? new Date(session.ended_at).toLocaleString('id-ID') : '-' },
                    { label: 'Durasi', render: (session) => formatWatchTime(session.duration_seconds || 0) },
                    { label: 'User Agent', key: 'user_agent' },
                ]}
            />

            <AnalyticsWorkspaceHeader
                title="Playback Analytics"
                description="Pantau siapa yang menonton playback publik dan admin secara terpisah dari live."
                lastUpdate={lastUpdate}
                filters={(
                    <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 lg:grid-cols-3">
                        <label className="space-y-1 text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-200">Periode</span>
                            <select value={period} onChange={(event) => setPeriod(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                {PERIOD_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>

                        <label className="space-y-1 text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-200">Kamera</span>
                            <select value={cameraId} onChange={(event) => setCameraId(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                <option value="">Semua Kamera</option>
                                {cameraOptions.map((camera) => (
                                    <option key={camera.id} value={camera.id}>{camera.name}</option>
                                ))}
                            </select>
                        </label>

                        <label className="space-y-1 text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-200">Akses</span>
                            <select value={accessMode} onChange={(event) => setAccessMode(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                {ACCESS_MODE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                )}
            />

            <AnalyticsTabNav tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

            {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                </div>
            )}

            {activeTab === 'overview' && (
                <div className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <StatCard label="Viewer Aktif Playback" value={loading ? '...' : overview.activeViewers || 0} tone="emerald" />
                        <StatCard label="Total Sesi Playback" value={loading ? '...' : overview.totalSessions || 0} tone="blue" />
                        <StatCard label="Unique Viewer" value={loading ? '...' : overview.uniqueViewers || 0} tone="amber" />
                        <StatCard label="Total Watch Time" value={loading ? '...' : formatWatchTime(overview.totalWatchTime || 0)} tone="violet" />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <StatCard label="Preview Publik" value={loading ? '...' : breakdownMap.public_preview || 0} tone="blue" />
                        <StatCard label="Admin Full" value={loading ? '...' : breakdownMap.admin_full || 0} tone="emerald" />
                    </div>

                    <SectionCard title="Preview Riwayat Playback">
                        <div className="space-y-3">
                            {recentSessions.length === 0 && (
                                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                                    Belum ada preview playback.
                                </div>
                            )}
                            {recentSessions.map((session) => (
                                <button
                                    key={session.id}
                                    onClick={() => setSelectedHistorySession(session)}
                                    className="w-full rounded-xl border border-gray-200 p-3 text-left transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="font-semibold text-gray-900 dark:text-white">{session.camera_name}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{session.segment_filename}</div>
                                        </div>
                                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                                            {session.playback_access_mode}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        {session.ip_address} • {new Date(session.started_at).toLocaleString('id-ID')} • {formatWatchTime(session.duration_seconds)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </SectionCard>
                </div>
            )}

            {activeTab === 'active' && (
                <div className="space-y-6">
                    <SectionCard title="Viewer Playback Aktif">
                        {activeSessions.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                                Tidak ada viewer playback aktif untuk filter ini.
                            </div>
                        ) : (
                            <div className="grid gap-3 xl:grid-cols-2">
                                {activeSessions.map((session) => (
                                    <div key={session.session_id || session.sessionId} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="font-semibold text-gray-900 dark:text-white">{session.camera_name || session.cameraName}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">{session.segment_filename || session.segmentFilename}</div>
                                            </div>
                                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                                                {session.playback_access_mode || session.playbackAccessMode}
                                            </span>
                                        </div>
                                        <div className="mt-3 grid gap-1 text-sm text-gray-600 dark:text-gray-300">
                                            <div>IP: {session.ip_address || session.ipAddress}</div>
                                            <div>Device: {session.device_type || session.deviceType}</div>
                                            <div>Durasi: {formatWatchTime(session.duration_seconds || session.durationSeconds || 0)}</div>
                                            {(session.admin_username || session.adminUsername) && (
                                                <div>Admin: {session.admin_username || session.adminUsername}</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </SectionCard>

                    <div className="grid gap-4 md:grid-cols-2">
                        <StatCard label="Sesi Preview Aktif" value={activeByAccess.public_preview || 0} tone="blue" />
                        <StatCard label="Sesi Admin Aktif" value={activeByAccess.admin_full || 0} tone="emerald" />
                    </div>
                </div>
            )}

            {activeTab === 'history' && (
                <div className="space-y-4">
                    {historyError && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                            {historyError}
                        </div>
                    )}
                    <AnalyticsHistoryTable
                        title="Riwayat Playback"
                        description={historyLoading ? 'Memuat riwayat playback...' : 'History penuh dengan pagination server-side dan filter operasional.'}
                        summary={history.summary}
                        items={history.items}
                        columns={[
                            { key: 'camera_name', label: 'Kamera / Segment' },
                            { key: 'playback_access_mode', label: 'Akses' },
                            { key: 'viewer', label: 'Viewer' },
                            { key: 'device_type', label: 'Perangkat' },
                            { key: 'started_at', label: 'Mulai' },
                            { key: 'duration_seconds', label: 'Durasi' },
                        ]}
                        rowKey={(item) => item.id}
                        renderCell={renderPlaybackHistoryCell}
                        pagination={history.pagination}
                        onPageChange={(page) => loadHistory({ page, pageSize: history.pagination.pageSize })}
                        onPageSizeChange={(pageSize) => loadHistory({ page: 1, pageSize })}
                        onRowClick={setSelectedHistorySession}
                        onExport={() => exportToCSV(history.items, 'playback_history')}
                        emptyTitle="Belum ada riwayat playback"
                        emptyDescription="Riwayat playback akan muncul setelah ada sesi preview publik atau admin."
                        filters={(
                            <div className="grid gap-3 lg:grid-cols-4">
                                <label className="space-y-1 text-sm">
                                    <span className="font-medium text-gray-700 dark:text-gray-200">Akses</span>
                                    <select value={accessMode} onChange={(event) => setAccessMode(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                        {ACCESS_MODE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="space-y-1 text-sm">
                                    <span className="font-medium text-gray-700 dark:text-gray-200">Perangkat</span>
                                    <select value={historyDeviceType} onChange={(event) => setHistoryDeviceType(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                        <option value="">Semua Perangkat</option>
                                        <option value="desktop">Desktop</option>
                                        <option value="mobile">Mobile</option>
                                        <option value="tablet">Tablet</option>
                                        <option value="unknown">Unknown</option>
                                    </select>
                                </label>
                                <label className="space-y-1 text-sm">
                                    <span className="font-medium text-gray-700 dark:text-gray-200">Urutkan</span>
                                    <select value={historySort} onChange={(event) => setHistorySort(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                        {SORT_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="space-y-1 text-sm">
                                    <span className="font-medium text-gray-700 dark:text-gray-200">Cari</span>
                                    <input
                                        value={historySearch}
                                        onChange={(event) => setHistorySearch(event.target.value)}
                                        placeholder="IP, segment, admin"
                                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                                    />
                                </label>
                            </div>
                        )}
                    />
                </div>
            )}

            {activeTab === 'top' && (
                <div className="grid gap-4 xl:grid-cols-3">
                    <SectionCard title="Top Kamera Playback">
                        <div className="space-y-3">
                            {topCameras.map((camera) => (
                                <div key={`${camera.camera_id}-${camera.camera_name}`} className="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                    <div className="font-semibold text-gray-900 dark:text-white">{camera.camera_name}</div>
                                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        {camera.total_sessions} sesi • {camera.unique_viewers} unique • {formatWatchTime(camera.total_watch_time)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </SectionCard>

                    <SectionCard title="Top Segment Playback">
                        <div className="space-y-3">
                            {topSegments.map((segment) => (
                                <div key={`${segment.camera_id}-${segment.segment_filename}-${segment.playback_access_mode}`} className="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                    <div className="font-semibold text-gray-900 dark:text-white">{segment.camera_name}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">{segment.segment_filename}</div>
                                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        {segment.playback_access_mode} • {segment.total_sessions} sesi • {formatWatchTime(segment.total_watch_time)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </SectionCard>

                    <SectionCard title="Top Access Mode">
                        <div className="space-y-3">
                            {accessBreakdown.map((item) => (
                                <div key={item.playback_access_mode} className="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                    <div className="font-semibold text-gray-900 dark:text-white">{item.playback_access_mode}</div>
                                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.count} sesi</div>
                                </div>
                            ))}
                        </div>
                    </SectionCard>
                </div>
            )}

            {activeTab === 'audience' && (
                <div className="grid gap-4 xl:grid-cols-2">
                    <SectionCard title="Device Breakdown">
                        <div className="space-y-3">
                            {deviceBreakdown.map((item) => (
                                <div key={item.device_type} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                    <div>{renderDeviceBadge(item.device_type)}</div>
                                    <div className="text-right text-sm text-gray-600 dark:text-gray-300">
                                        <div className="font-semibold text-gray-900 dark:text-white">{item.count}</div>
                                        <div>{item.percentage || 0}%</div>
                                    </div>
                                </div>
                            ))}
                            {deviceBreakdown.length === 0 && (
                                <div className="text-sm text-gray-500 dark:text-gray-400">Belum ada distribusi perangkat.</div>
                            )}
                        </div>
                    </SectionCard>

                    <SectionCard title="Top Viewer Playback">
                        <div className="space-y-3">
                            {topViewers.map((viewer) => (
                                <div key={viewer.ip_address} className="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                    <div className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{viewer.ip_address}</div>
                                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        {viewer.total_sessions} sesi • {viewer.cameras_watched} kamera • {formatWatchTime(viewer.total_watch_time)}
                                    </div>
                                </div>
                            ))}
                            {topViewers.length === 0 && (
                                <div className="text-sm text-gray-500 dark:text-gray-400">Belum ada viewer playback dominan.</div>
                            )}
                        </div>
                    </SectionCard>
                </div>
            )}
        </div>
    );
}
