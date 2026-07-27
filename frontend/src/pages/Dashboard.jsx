/*
Purpose: Admin dashboard route shell for system status, stream overview, and operational shortcuts.
Caller: App.jsx protected /admin/dashboard route.
Deps: React, react-router-dom, dashboard components, dashboard data hook, components/ui primitives.
MainFuncs: Dashboard.
SideEffects: Fetches dashboard stats through useDashboardData.
*/

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { Button, Card, PageHeader } from '../components/ui';
import { QuickStatsCards } from '../components/QuickStatsCards';
import { DateRangeSelector } from '../components/DateRangeSelector';
import { DashboardInitialSkeleton } from '../components/admin/dashboard/DashboardSkeletons';
import {
    DashboardStreamsPanel,
    rankDashboardStreams,
    StreamsDrawer,
    ViewerSessionsModal,
} from '../components/admin/dashboard/DashboardStreams';
import { DashboardAttentionItems, DashboardStatsOverview } from '../components/admin/dashboard/DashboardSummaryCards';
import { DashboardSidebar } from '../components/admin/dashboard/DashboardSidebar';
import { useDashboardData } from '../hooks/admin/useDashboardData';

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatLastUpdate(date) {
    if (!date) return 'Belum pernah';
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'Baru saja';
    if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
    return date.toLocaleTimeString();
}

/*
 * Transport and operational state both map onto the status tokens, and `maintenance` maps to WARN,
 * not fault. Red means a camera is actually broken; a camera deliberately held for servicing is a
 * different fact, and rendering both red is what made the old dashboard read as an alarm board.
 */
const STATE_TONE = {
    ready: 'border-status-live/30 bg-status-live/10 text-status-live',
    online: 'border-status-live/30 bg-status-live/10 text-status-live',
    buffering: 'border-status-warn/30 bg-status-warn/10 text-status-warn',
    maintenance: 'border-status-warn/30 bg-status-warn/10 text-status-warn',
    offline: 'border-status-fault/30 bg-status-fault/10 text-status-fault',
    invalid: 'border-edge bg-surface-raised text-content-muted',
};
const NEUTRAL_TONE = 'border-edge bg-surface-raised text-content-muted';

function getStreamTransportTone(state) {
    return STATE_TONE[state] ?? NEUTRAL_TONE;
}

function getOperationalTone(state) {
    return STATE_TONE[state] ?? NEUTRAL_TONE;
}

function DashboardErrorState({ error, isRetrying, onRetry }) {
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-card bg-status-fault/10 text-status-fault">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h1 className="mb-2 text-xl font-bold text-content">Dashboard gagal dimuat</h1>
            <p className="mb-6 max-w-md text-center text-sm text-content-muted">{error}</p>
            <Button variant="primary" loading={isRetrying} onClick={onRetry}>
                {isRetrying ? 'Mencoba lagi…' : 'Coba lagi'}
            </Button>
        </div>
    );
}

function MediaServerWarning() {
    return (
        <Card className="border-status-fault/30 bg-status-fault/10">
            <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 text-status-fault">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </span>
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-status-fault">MediaMTX offline</h2>
                    <p className="mt-1 text-sm text-content-muted">
                        Server media tidak merespons. Status transport stream akan terbatas sampai koneksi pulih.
                    </p>
                </div>
            </div>
        </Card>
    );
}

const RefreshIcon = ({ spinning }) => (
    <svg className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
);

export default function Dashboard() {
    const [viewerModal, setViewerModal] = useState(null);
    const [isStreamsDrawerOpen, setIsStreamsDrawerOpen] = useState(false);
    const navigate = useNavigate();
    const {
        stats,
        loading,
        error,
        lastSuccessfulUpdate,
        refreshError,
        isRetrying,
        dateRange,
        setDateRange,
        setRefreshError,
        loadStats,
        handleRetry,
    } = useDashboardData();

    const rankedStreams = useMemo(() => rankDashboardStreams(stats?.streams || []), [stats?.streams]);
    const visibleStreams = useMemo(() => rankedStreams.slice(0, 8), [rankedStreams]);
    const overflowStreamCount = Math.max(rankedStreams.length - visibleStreams.length, 0);

    const cpuLoad = stats?.system?.cpuLoad ?? 0;
    const totalMem = stats?.system?.totalMem || 0;
    const memUsed = totalMem - (stats?.system?.freeMem || 0);
    const memPercent = totalMem > 0 ? Math.round((memUsed / totalMem) * 100) : 0;
    const attentionItems = [
        !stats?.mtxConnected && {
            title: 'Media server offline',
            description: 'Transport stream tidak bisa dipantau sampai MediaMTX kembali terhubung.',
            tone: 'fault',
        },
        (stats?.cameraStatusBreakdown?.offline || 0) > 0 && {
            title: `${stats.cameraStatusBreakdown.offline} kamera offline`,
            description: 'Perlu pengecekan koneksi atau sumber stream.',
            tone: 'warn',
        },
        (stats?.cameraStatusBreakdown?.maintenance || 0) > 0 && {
            title: `${stats.cameraStatusBreakdown.maintenance} kamera maintenance`,
            description: 'Status operasional sedang ditahan untuk perbaikan.',
            tone: 'idle',
        },
        refreshError && {
            title: 'Refresh background gagal',
            description: `Data terakhir yang valid: ${formatLastUpdate(lastSuccessfulUpdate)}.`,
            tone: 'data',
        },
    ].filter(Boolean);

    if (loading && !stats) {
        return <DashboardInitialSkeleton />;
    }

    if (error && !stats) {
        return <DashboardErrorState error={error} isRetrying={isRetrying} onRetry={handleRetry} />;
    }

    return (
        <div className="space-y-6">
            {refreshError && (
                <Alert
                    type="warning"
                    title="Refresh background gagal"
                    message={`Data terbaru belum bisa diambil. Update valid terakhir: ${formatLastUpdate(lastSuccessfulUpdate)}`}
                    dismissible
                    onDismiss={() => setRefreshError(false)}
                />
            )}

            {stats && !stats.mtxConnected && <MediaServerWarning />}

            {/*
              * The old header carried three buttons — Tambah Kamera, Analytics, Settings — that all
              * just navigated to destinations already in the sidebar AND the mobile dock. Refresh is
              * the only action that belongs to this page.
              */}
            <PageHeader
                title="Dashboard"
                description={`Memantau ${stats?.summary.totalCameras ?? 0} kamera di ${stats?.summary.totalAreas ?? 0} area`}
                actions={(
                    <Button
                        icon={<RefreshIcon spinning={isRetrying} />}
                        disabled={isRetrying}
                        onClick={() => loadStats({ mode: 'initial' })}
                    >
                        Muat ulang
                    </Button>
                )}
            />

            <DashboardAttentionItems items={attentionItems} />

            <DashboardStatsOverview
                stats={stats}
                cpuLoad={cpuLoad}
                memUsed={memUsed}
                memPercent={memPercent}
                formatBytes={formatBytes}
                onOpenViewer={setViewerModal}
            />

            <div className="space-y-3">
                <DateRangeSelector value={dateRange} onChange={setDateRange} />
                <QuickStatsCards dateRange={dateRange} />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <DashboardStreamsPanel
                    stats={stats}
                    rankedStreams={rankedStreams}
                    visibleStreams={visibleStreams}
                    overflowStreamCount={overflowStreamCount}
                    formatBytes={formatBytes}
                    getOperationalTone={getOperationalTone}
                    getStreamTransportTone={getStreamTransportTone}
                    onOpenViewer={setViewerModal}
                    onOpenDrawer={() => setIsStreamsDrawerOpen(true)}
                    onAddCamera={() => navigate('/admin/cameras')}
                    onRetry={handleRetry}
                />

                <DashboardSidebar
                    topCameras={stats?.topCameras || []}
                    recentLogs={stats?.recentLogs || []}
                    mtxConnected={stats?.mtxConnected}
                    lastUpdateLabel={formatLastUpdate(lastSuccessfulUpdate)}
                    refreshFailed={Boolean(refreshError)}
                />
            </div>

            {viewerModal && (
                <ViewerSessionsModal
                    title={viewerModal.title}
                    sessions={viewerModal.sessions}
                    onClose={() => setViewerModal(null)}
                />
            )}

            <StreamsDrawer
                open={isStreamsDrawerOpen}
                streams={rankedStreams}
                onClose={() => setIsStreamsDrawerOpen(false)}
                formatBytes={formatBytes}
                getOperationalTone={getOperationalTone}
                getStreamTransportTone={getStreamTransportTone}
                onOpenViewer={setViewerModal}
            />
        </div>
    );
}
