import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../components/ui/Alert';
import { HeatmapDetailModal } from '../components/ActivityHeatmap';
import { CameraPerformanceTable } from '../components/CameraPerformanceTable';
import { RealtimeActivityChart } from '../components/RealtimeChart';
import { RetentionMetrics } from '../components/RetentionMetrics';
import DailyDetailModal from '../components/admin/analytics/DailyDetailModal';
import { ActiveViewerCard, PeriodSelector } from '../components/admin/analytics/AnalyticsPrimitives';
import AnalyticsHistoryTable, { AnalyticsHistoryDrawer, renderDeviceBadge, renderDurationText } from '../components/admin/analytics/AnalyticsHistoryTable';
import { AnalyticsTabNav, AnalyticsWorkspaceHeader } from '../components/admin/analytics/AnalyticsWorkspace';
import ViewerAnalyticsAudienceSection from '../components/admin/analytics/ViewerAnalyticsAudienceSection';
import ViewerAnalyticsChartsSection from '../components/admin/analytics/ViewerAnalyticsChartsSection';
import ViewerAnalyticsSkeleton from '../components/admin/analytics/ViewerAnalyticsSkeleton';
import ViewerAnalyticsSummaryGrid from '../components/admin/analytics/ViewerAnalyticsSummaryGrid';
import { useViewerAnalyticsData } from '../hooks/admin/useViewerAnalyticsData';
import { useViewerAnalyticsFilters } from '../hooks/admin/useViewerAnalyticsFilters';
import { adminService } from '../services/adminService';
import { cameraService } from '../services/cameraService';
import { REQUEST_POLICY } from '../services/requestPolicy';
import { exportToCSV, formatWatchTime, mapPeriodToApi } from '../utils/admin/viewerAnalyticsAdapter';

export { default as DailyDetailModal } from '../components/admin/analytics/DailyDetailModal';

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'active', label: 'Active' },
    { id: 'history', label: 'History' },
    { id: 'top', label: 'Top' },
    { id: 'audience', label: 'Audience' },
];

const SORT_OPTIONS = [
    { value: 'started_at:desc', label: 'Terbaru' },
    { value: 'started_at:asc', label: 'Terlama' },
    { value: 'duration_seconds:desc', label: 'Durasi Terpanjang' },
    { value: 'camera_name:asc', label: 'Kamera A-Z' },
];

function TopMetricCard({ title, children }) {
    return (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
            <div className="mt-4">{children}</div>
        </section>
    );
}

function renderLiveHistoryCell(session, column) {
    switch (column.key) {
        case 'camera_name':
            return <span className="font-semibold text-gray-900 dark:text-white">{session.camera_name}</span>;
        case 'ip_address':
            return <span className="font-mono text-xs">{session.ip_address}</span>;
        case 'device_type':
            return renderDeviceBadge(session.device_type);
        case 'started_at':
            return new Date(session.started_at).toLocaleString('id-ID');
        case 'ended_at':
            return session.ended_at ? new Date(session.ended_at).toLocaleString('id-ID') : '-';
        case 'duration_seconds':
            return renderDurationText(session.duration_seconds);
        default:
            return session[column.key] ?? '-';
    }
}

export default function ViewerAnalytics() {
    const {
        period,
        customDate,
        selectedCamera,
        selectedDate,
        showDailyDetail,
        heatmapCell,
        showHeatmapDetail,
        selectCamera,
        selectPeriod,
        selectCustomDate,
        openDailyDetail,
        closeDailyDetail,
        openHeatmapDetail,
        closeHeatmapDetail,
    } = useViewerAnalyticsFilters();
    const [activeTab, setActiveTab] = useState('overview');
    const [cameraOptions, setCameraOptions] = useState([]);
    const [history, setHistory] = useState({ items: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 }, summary: { totalItems: 0, uniqueViewers: 0, totalWatchTime: 0 } });
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState('');
    const [historyDeviceType, setHistoryDeviceType] = useState('');
    const [historySearch, setHistorySearch] = useState('');
    const [historySort, setHistorySort] = useState('started_at:desc');
    const [selectedHistorySession, setSelectedHistorySession] = useState(null);
    const historyRequestIdRef = useRef(0);

    const {
        analytics,
        loading,
        error,
        refreshError,
        lastUpdate,
        setRefreshError,
        retry,
    } = useViewerAnalyticsData(period, customDate);

    useEffect(() => {
        let isMounted = true;

        const loadCameras = async () => {
            try {
                const response = await cameraService.getAllCameras(REQUEST_POLICY.BLOCKING);
                if (!isMounted || !response.success) {
                    return;
                }

                setCameraOptions(
                    (response.data || []).map((camera) => ({
                        id: camera.id,
                        name: camera.name,
                    }))
                );
            } catch (cameraError) {
                console.error('Load viewer analytics cameras error:', cameraError);
            }
        };

        loadCameras();
        return () => {
            isMounted = false;
        };
    }, []);

    const loadHistory = useCallback(async ({
        page = history.pagination.page,
        pageSize = history.pagination.pageSize,
    } = {}) => {
        const requestId = ++historyRequestIdRef.current;
        setHistoryLoading(true);
        const [sortBy, sortDirection] = historySort.split(':');

        try {
            const response = await adminService.getViewerHistory({
                period: mapPeriodToApi(period, customDate),
                page,
                pageSize,
                cameraId: selectedCamera || undefined,
                deviceType: historyDeviceType || undefined,
                search: historySearch || undefined,
                sortBy,
                sortDirection,
            }, REQUEST_POLICY.BLOCKING);

            if (requestId !== historyRequestIdRef.current) {
                return;
            }

            if (!response.success) {
                throw new Error(response.message || 'Gagal memuat riwayat sesi');
            }

            setHistory(response.data);
            setHistoryError('');
        } catch (loadError) {
            if (requestId !== historyRequestIdRef.current) {
                return;
            }
            setHistoryError(loadError.message || 'Gagal memuat riwayat sesi');
        } finally {
            if (requestId === historyRequestIdRef.current) {
                setHistoryLoading(false);
            }
        }
    }, [customDate, history.pagination.page, history.pagination.pageSize, historyDeviceType, historySearch, historySort, period, selectedCamera]);

    useEffect(() => {
        loadHistory({ page: 1, pageSize: history.pagination.pageSize });
    }, [loadHistory, history.pagination.pageSize]);

    const analyticsPreviewSessions = useMemo(() => (analytics?.recentSessions || []).slice(0, 5), [analytics?.recentSessions]);
    const topVisitors = useMemo(() => analytics?.topVisitors || [], [analytics?.topVisitors]);
    const activeSessions = analytics?.activeSessions || [];
    const topCameras = analytics?.topCameras || [];
    const deviceBreakdown = analytics?.deviceBreakdown || [];
    const peakHours = analytics?.peakHours || [];
    const retention = analytics?.retention;
    const cameraPerformance = analytics?.cameraPerformance || [];
    const charts = analytics?.charts || {};
    const overview = analytics?.overview;
    const comparison = analytics?.comparison;

    const sessionsByDayData = (charts?.sessionsByDay || []).slice(-14).map((item) => ({
        label: new Date(item.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' }),
        value: item.sessions,
        rawDate: item.date,
    }));
    const hourlyData = (charts?.sessionsByHour || []).map((item) => ({
        label: `${item.hour}:00`,
        value: item.sessions,
    }));
    const activeByCamera = useMemo(() => {
        return activeSessions.reduce((accumulator, session) => {
            const key = session.cameraName || session.camera_name || '-';
            accumulator[key] = (accumulator[key] || 0) + 1;
            return accumulator;
        }, {});
    }, [activeSessions]);

    if (loading && !analytics) {
        return <ViewerAnalyticsSkeleton />;
    }

    if (error && !analytics) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 text-red-500 dark:bg-red-500/10">
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">Gagal Memuat Analytics</h2>
                <p className="mb-6 text-gray-500 dark:text-gray-400">{error}</p>
                <button onClick={retry} className="rounded-lg bg-primary px-4 py-2 font-medium text-white transition-colors hover:bg-primary-600">
                    Coba Lagi
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {showDailyDetail && (
                <DailyDetailModal date={selectedDate} sessions={analytics?.recentSessions || []} onClose={closeDailyDetail} />
            )}

            {showHeatmapDetail && (
                <HeatmapDetailModal cellData={heatmapCell} onClose={closeHeatmapDetail} />
            )}

            <AnalyticsHistoryDrawer
                open={Boolean(selectedHistorySession)}
                session={selectedHistorySession}
                title="Detail Sesi Live"
                onClose={() => setSelectedHistorySession(null)}
                fields={[
                    { label: 'Kamera', key: 'camera_name' },
                    { label: 'IP Address', key: 'ip_address' },
                    { label: 'Device', key: 'device_type' },
                    { label: 'Mulai', render: (session) => new Date(session.started_at).toLocaleString('id-ID') },
                    { label: 'Selesai', render: (session) => session.ended_at ? new Date(session.ended_at).toLocaleString('id-ID') : '-' },
                    { label: 'Durasi', render: (session) => formatWatchTime(session.duration_seconds || 0) },
                    { label: 'User Agent', key: 'user_agent' },
                ]}
            />

            {refreshError && (
                <Alert
                    type="warning"
                    title="Auto-refresh gagal"
                    message={`Tidak dapat memuat data terbaru. Update terakhir: ${lastUpdate?.toLocaleTimeString('id-ID') || '-'}`}
                    dismissible
                    onDismiss={() => setRefreshError(false)}
                />
            )}

            <AnalyticsWorkspaceHeader
                title="Statistik Penonton"
                description="Workspace analytics live untuk overview, realtime, history, top, dan audience."
                lastUpdate={lastUpdate}
                filters={(
                    <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 lg:grid-cols-[minmax(0,1fr)_260px]">
                        <div>
                            <div className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-200">Periode</div>
                            <PeriodSelector
                                value={period}
                                onChange={selectPeriod}
                                customDate={customDate}
                                onCustomDateChange={selectCustomDate}
                            />
                        </div>
                        <label className="space-y-1 text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-200">Kamera</span>
                            <select value={selectedCamera} onChange={(event) => selectCamera(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                <option value="">Semua Kamera</option>
                                {cameraOptions.map((camera) => (
                                    <option key={camera.id} value={camera.id}>{camera.name}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                )}
            />

            <AnalyticsTabNav tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

            {activeTab === 'overview' && (
                <div className="space-y-6">
                    <ViewerAnalyticsSummaryGrid overview={overview} comparison={comparison} />
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
                        <div className="space-y-4">
                            <RealtimeActivityChart />
                            <ViewerAnalyticsChartsSection
                                charts={charts}
                                sessionsByDayData={sessionsByDayData}
                                hourlyData={hourlyData}
                                selectedDate={selectedDate}
                                onBarClick={(item) => openDailyDetail(item.rawDate)}
                                onHeatmapCellClick={openHeatmapDetail}
                            />
                        </div>
                        <TopMetricCard title="Preview Sesi Terbaru">
                            <div className="space-y-3">
                                {analyticsPreviewSessions.length === 0 && (
                                    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                                        Belum ada preview sesi.
                                    </div>
                                )}
                                {analyticsPreviewSessions.map((session) => (
                                    <button
                                        key={session.id}
                                        onClick={() => setSelectedHistorySession(session)}
                                        className="w-full rounded-xl border border-gray-200 p-3 text-left transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="font-semibold text-gray-900 dark:text-white">{session.camera_name}</div>
                                            {renderDeviceBadge(session.device_type)}
                                        </div>
                                        <div className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{session.ip_address}</div>
                                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                            {new Date(session.started_at).toLocaleString('id-ID')} • {formatWatchTime(session.duration_seconds)}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </TopMetricCard>
                    </div>
                </div>
            )}

            {activeTab === 'active' && (
                <div className="space-y-6">
                    <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Viewer Aktif</h2>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{activeSessions.length} orang sedang menonton</p>
                            </div>
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                LIVE
                            </span>
                        </div>
                        {activeSessions.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                                Tidak ada viewer aktif untuk filter ini.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                                {activeSessions.map((session, index) => (
                                    <ActiveViewerCard key={session.sessionId || index} session={session} />
                                ))}
                            </div>
                        )}
                    </section>

                    <div className="grid gap-4 xl:grid-cols-2">
                        <TopMetricCard title="Active by Camera">
                            <div className="space-y-3">
                                {Object.entries(activeByCamera).map(([cameraName, count]) => (
                                    <div key={cameraName} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                        <span className="font-medium text-gray-900 dark:text-white">{cameraName}</span>
                                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary dark:bg-primary/20 dark:text-primary-300">
                                            {count} aktif
                                        </span>
                                    </div>
                                ))}
                                {Object.keys(activeByCamera).length === 0 && (
                                    <div className="text-sm text-gray-500 dark:text-gray-400">Belum ada distribusi aktif.</div>
                                )}
                            </div>
                        </TopMetricCard>

                        <TopMetricCard title="Active by Device">
                            <div className="space-y-3">
                                {deviceBreakdown.map((item) => (
                                    <div key={item.device_type} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                        <div>{renderDeviceBadge(item.device_type)}</div>
                                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{item.count}</span>
                                    </div>
                                ))}
                                {deviceBreakdown.length === 0 && (
                                    <div className="text-sm text-gray-500 dark:text-gray-400">Belum ada distribusi perangkat.</div>
                                )}
                            </div>
                        </TopMetricCard>
                    </div>
                </div>
            )}

            {activeTab === 'history' && (
                <div className="space-y-4">
                    {historyError && (
                        <Alert type="warning" title="Riwayat sesi" message={historyError} />
                    )}
                    <AnalyticsHistoryTable
                        title="Riwayat Sesi Live"
                        description={historyLoading ? 'Memuat data history dari server...' : 'Tabel history penuh dengan filter, search, sort, dan pagination server-side.'}
                        summary={history.summary}
                        items={history.items}
                        columns={[
                            { key: 'camera_name', label: 'Kamera' },
                            { key: 'ip_address', label: 'IP Address' },
                            { key: 'device_type', label: 'Perangkat' },
                            { key: 'started_at', label: 'Mulai' },
                            { key: 'ended_at', label: 'Selesai' },
                            { key: 'duration_seconds', label: 'Durasi' },
                        ]}
                        rowKey={(item) => item.id}
                        renderCell={renderLiveHistoryCell}
                        pagination={history.pagination}
                        onPageChange={(page) => loadHistory({ page, pageSize: history.pagination.pageSize })}
                        onPageSizeChange={(pageSize) => loadHistory({ page: 1, pageSize })}
                        onRowClick={setSelectedHistorySession}
                        onExport={() => exportToCSV(history.items, 'viewer_history')}
                        emptyTitle="Belum ada sesi"
                        emptyDescription="Riwayat live akan muncul setelah ada pengunjung yang menonton."
                        filters={(
                            <div className="grid gap-3 lg:grid-cols-4">
                                <label className="space-y-1 text-sm">
                                    <span className="font-medium text-gray-700 dark:text-gray-200">Kamera</span>
                                    <select value={selectedCamera} onChange={(event) => selectCamera(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                                        <option value="">Semua Kamera</option>
                                        {cameraOptions.map((camera) => (
                                            <option key={camera.id} value={camera.id}>{camera.name}</option>
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
                                        placeholder="IP, kamera, perangkat"
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
                    <TopMetricCard title="Top Kamera">
                        <div className="space-y-3">
                            {topCameras.map((camera) => (
                                <div key={camera.camera_id} className="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                    <div className="font-semibold text-gray-900 dark:text-white">{camera.camera_name}</div>
                                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        {camera.total_views} sesi • {camera.unique_viewers} unique • {formatWatchTime(camera.total_watch_time)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </TopMetricCard>

                    <TopMetricCard title="Top Visitor">
                        <div className="space-y-3">
                            {topVisitors.map((visitor) => (
                                <div key={visitor.ip_address} className="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                    <div className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{visitor.ip_address}</div>
                                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        {visitor.total_sessions} sesi • {visitor.cameras_watched} kamera • {formatWatchTime(visitor.total_watch_time)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </TopMetricCard>

                    <TopMetricCard title="Peak Hours">
                        <div className="space-y-3">
                            {peakHours.map((hour) => (
                                <div key={hour.hour} className="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-950/60">
                                    <div className="font-semibold text-gray-900 dark:text-white">{hour.hour}:00</div>
                                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        {hour.sessions} sesi • {hour.unique_visitors} unique
                                    </div>
                                </div>
                            ))}
                        </div>
                    </TopMetricCard>
                </div>
            )}

            {activeTab === 'audience' && (
                <div className="space-y-6">
                    <ViewerAnalyticsAudienceSection
                        topCameras={topCameras}
                        deviceBreakdown={deviceBreakdown}
                        topVisitors={topVisitors}
                        peakHours={peakHours}
                        onExportVisitors={() => exportToCSV(topVisitors, 'top_visitors')}
                    />
                    {retention && <RetentionMetrics data={retention} />}
                    {cameraPerformance.length > 0 && <CameraPerformanceTable data={cameraPerformance} />}
                </div>
            )}
        </div>
    );
}
