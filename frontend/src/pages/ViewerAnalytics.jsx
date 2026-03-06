import { Alert } from '../components/ui/Alert';
import { useCallback, useMemo } from 'react';
import { HeatmapDetailModal } from '../components/ActivityHeatmap';
import { CameraPerformanceTable } from '../components/CameraPerformanceTable';
import { RealtimeActivityChart } from '../components/RealtimeChart';
import { RetentionMetrics } from '../components/RetentionMetrics';
import DailyDetailModal from '../components/admin/analytics/DailyDetailModal';
import { ActiveViewerCard } from '../components/admin/analytics/AnalyticsPrimitives';
import ViewerAnalyticsAudienceSection from '../components/admin/analytics/ViewerAnalyticsAudienceSection';
import ViewerAnalyticsChartsSection from '../components/admin/analytics/ViewerAnalyticsChartsSection';
import ViewerAnalyticsHeader from '../components/admin/analytics/ViewerAnalyticsHeader';
import ViewerAnalyticsSessionsSection from '../components/admin/analytics/ViewerAnalyticsSessionsSection';
import ViewerAnalyticsSkeleton from '../components/admin/analytics/ViewerAnalyticsSkeleton';
import ViewerAnalyticsSummaryGrid from '../components/admin/analytics/ViewerAnalyticsSummaryGrid';
import { useViewerAnalyticsData } from '../hooks/admin/useViewerAnalyticsData';
import { useViewerAnalyticsFilters } from '../hooks/admin/useViewerAnalyticsFilters';
import { exportToCSV } from '../utils/admin/viewerAnalyticsAdapter';

export { default as DailyDetailModal } from '../components/admin/analytics/DailyDetailModal';

export default function ViewerAnalytics() {
    const {
        period,
        customDate,
        selectedCamera,
        selectedDate,
        showDailyDetail,
        heatmapCell,
        showHeatmapDetail,
        sessionsPage,
        setSessionsPage,
        selectCamera,
        selectPeriod,
        selectCustomDate,
        openDailyDetail,
        closeDailyDetail,
        openHeatmapDetail,
        closeHeatmapDetail,
    } = useViewerAnalyticsFilters();

    const {
        analytics,
        loading,
        error,
        refreshError,
        lastUpdate,
        setRefreshError,
        retry,
    } = useViewerAnalyticsData(period, customDate);

    const recentSessions = useMemo(() => analytics?.recentSessions || [], [analytics?.recentSessions]);
    const topVisitors = useMemo(() => analytics?.topVisitors || [], [analytics?.topVisitors]);
    const sessionsPerPage = 15;
    const filteredSessions = useMemo(() => {
        if (!selectedCamera) {
            return recentSessions;
        }

        return recentSessions.filter((session) => String(session.camera_id) === selectedCamera);
    }, [recentSessions, selectedCamera]);

    const paginatedSessions = useMemo(() => {
        const start = (sessionsPage - 1) * sessionsPerPage;
        return filteredSessions.slice(start, start + sessionsPerPage);
    }, [filteredSessions, sessionsPage]);

    const totalSessionPages = Math.ceil(filteredSessions.length / sessionsPerPage);
    const exportSessions = useCallback(() => {
        exportToCSV(filteredSessions, 'viewer_sessions');
    }, [filteredSessions]);
    const exportVisitors = useCallback(() => {
        exportToCSV(topVisitors, 'top_visitors');
    }, [topVisitors]);

    if (loading && !analytics) {
        return <ViewerAnalyticsSkeleton />;
    }

    if (error && !analytics) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mb-4">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Gagal Memuat Analytics</h2>
                <p className="text-gray-500 dark:text-gray-400 mb-6">{error}</p>
                <button onClick={retry} className="px-4 py-2 bg-primary hover:bg-primary-600 text-white font-medium rounded-lg transition-colors">
                    Coba Lagi
                </button>
            </div>
        );
    }

    const {
        overview,
        comparison,
        retention,
        charts,
        topCameras,
        deviceBreakdown,
        peakHours,
        cameraPerformance,
        activeSessions,
    } = analytics || {};

    const sessionsByDayData = (charts?.sessionsByDay || []).slice(-14).map((item) => ({
        label: new Date(item.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' }),
        value: item.sessions,
        rawDate: item.date,
    }));

    const hourlyData = (charts?.sessionsByHour || []).map((item) => ({
        label: `${item.hour}:00`,
        value: item.sessions,
    }));

    return (
        <div className="space-y-8">
            {showDailyDetail && (
                <DailyDetailModal date={selectedDate} sessions={recentSessions} onClose={closeDailyDetail} />
            )}

            {showHeatmapDetail && (
                <HeatmapDetailModal cellData={heatmapCell} onClose={closeHeatmapDetail} />
            )}

            {refreshError && (
                <Alert
                    type="warning"
                    title="Auto-refresh gagal"
                    message={`Tidak dapat memuat data terbaru. Update terakhir: ${lastUpdate?.toLocaleTimeString('id-ID') || '-'}`}
                    dismissible
                    onDismiss={() => setRefreshError(false)}
                />
            )}

            <ViewerAnalyticsHeader
                lastUpdate={lastUpdate}
                period={period}
                customDate={customDate}
                onPeriodChange={selectPeriod}
                onCustomDateChange={selectCustomDate}
            />

            <ViewerAnalyticsSummaryGrid overview={overview} comparison={comparison} />

            <RealtimeActivityChart />

            {activeSessions && activeSessions.length > 0 && (
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-500">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Viewer Aktif</h2>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{activeSessions.length} orang sedang menonton</p>
                            </div>
                        </div>
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg text-sm font-medium">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            LIVE
                        </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {activeSessions.map((session, index) => (
                            <ActiveViewerCard key={session.sessionId || index} session={session} />
                        ))}
                    </div>
                </div>
            )}

            {retention && <RetentionMetrics data={retention} />}
            {cameraPerformance && cameraPerformance.length > 0 && <CameraPerformanceTable data={cameraPerformance} />}

            <ViewerAnalyticsChartsSection
                charts={charts}
                sessionsByDayData={sessionsByDayData}
                hourlyData={hourlyData}
                selectedDate={selectedDate}
                onBarClick={(item) => openDailyDetail(item.rawDate)}
                onHeatmapCellClick={openHeatmapDetail}
            />

            <ViewerAnalyticsAudienceSection
                topCameras={topCameras}
                deviceBreakdown={deviceBreakdown}
                topVisitors={topVisitors}
                peakHours={peakHours}
                onExportVisitors={exportVisitors}
            />

            <ViewerAnalyticsSessionsSection
                topCameras={topCameras}
                selectedCamera={selectedCamera}
                onCameraChange={selectCamera}
                filteredSessions={filteredSessions}
                paginatedSessions={paginatedSessions}
                sessionsPage={sessionsPage}
                totalSessionPages={totalSessionPages}
                onPageChange={setSessionsPage}
                onExportSessions={exportSessions}
            />
        </div>
    );
}
