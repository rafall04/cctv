/*
Purpose: Admin dashboard route shell for system status, stream overview, and operational shortcuts.
Caller: App.jsx protected /admin/dashboard route.
Deps: React, react-router-dom, dashboard components, dashboard data hook, shared UI/status widgets.
MainFuncs: Dashboard.
SideEffects: Fetches dashboard stats through useDashboardData and navigates to admin tools.
*/

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { CameraStatusOverview } from '../components/CameraStatusOverview';
import { QuickStatsCards } from '../components/QuickStatsCards';
import { DateRangeSelector } from '../components/DateRangeSelector';
import { DashboardInitialSkeleton } from '../components/admin/dashboard/DashboardSkeletons';
import {
    DashboardStreamsPanel,
    rankDashboardStreams,
    StreamsDrawer,
    ViewerSessionsModal,
} from '../components/admin/dashboard/DashboardStreams';
import { DashboardAttentionItems, DashboardSummaryCards } from '../components/admin/dashboard/DashboardSummaryCards';
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
    if (!date) return 'Never';
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return date.toLocaleTimeString();
}

function getStreamTransportTone(state) {
    switch (state) {
        case 'ready':
            return 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400';
        case 'buffering':
            return 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400';
        case 'maintenance':
            return 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400';
        case 'invalid':
        case 'offline':
        default:
            return 'bg-gray-100 text-gray-600 dark:bg-gray-700/70 dark:text-gray-300';
    }
}

function getOperationalTone(state) {
    switch (state) {
        case 'online':
            return 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400';
        case 'maintenance':
            return 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400';
        case 'offline':
        default:
            return 'bg-gray-100 text-gray-600 dark:bg-gray-700/70 dark:text-gray-300';
    }
}

function DashboardErrorState({ error, isRetrying, onRetry }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mb-4">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Failed to Load Dashboard</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6 text-center max-w-md">{error}</p>
            <button
                onClick={onRetry}
                disabled={isRetrying}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-600 disabled:bg-primary-400 text-white font-medium rounded-lg transition-colors"
            >
                <svg className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isRetrying ? 'Retrying...' : 'Retry'}
            </button>
        </div>
    );
}

function MediaServerWarning() {
    return (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-red-100 dark:bg-red-500/20 rounded-lg flex items-center justify-center text-red-500">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <div className="flex-1">
                    <h3 className="text-sm font-semibold text-red-800 dark:text-red-400">MediaMTX offline</h3>
                    <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                        Server media tidak merespons. Status transport stream akan terbatas sampai koneksi pulih.
                    </p>
                </div>
            </div>
        </div>
    );
}

function DashboardHeader({ stats, lastSuccessfulUpdate, isRetrying, onRefresh, onNavigate }) {
    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <p className="text-sm font-semibold text-primary">Ringkasan Sistem</p>
                        {lastSuccessfulUpdate && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                                Updated {formatLastUpdate(lastSuccessfulUpdate)}
                            </span>
                        )}
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Monitoring {stats?.summary.totalCameras} kamera di {stats?.summary.totalAreas} area
                    </p>
                </div>

                <button
                    onClick={onRefresh}
                    disabled={isRetrying}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all disabled:opacity-50 self-start sm:self-auto"
                    title="Refresh Dashboard"
                >
                    <svg className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className="hidden sm:inline">Refresh</span>
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={() => onNavigate('/admin/cameras')}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-primary to-primary-600 hover:from-primary-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    <span>Tambah Kamera</span>
                </button>
                <button
                    onClick={() => onNavigate('/admin/analytics')}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all"
                >
                    <span>Analytics</span>
                </button>
                <button
                    onClick={() => onNavigate('/admin/settings')}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all"
                >
                    <span>Settings</span>
                </button>
            </div>
        </div>
    );
}

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
            tone: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300',
        },
        (stats?.cameraStatusBreakdown?.offline || 0) > 0 && {
            title: `${stats.cameraStatusBreakdown.offline} kamera offline`,
            description: 'Perlu pengecekan koneksi atau sumber stream.',
            tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
        },
        (stats?.cameraStatusBreakdown?.maintenance || 0) > 0 && {
            title: `${stats.cameraStatusBreakdown.maintenance} kamera maintenance`,
            description: 'Status operasional sedang ditahan untuk perbaikan.',
            tone: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300',
        },
        refreshError && {
            title: 'Refresh background gagal',
            description: `Data terakhir yang valid: ${formatLastUpdate(lastSuccessfulUpdate)}.`,
            tone: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-primary/20 dark:bg-primary/10 dark:text-sky-300',
        },
    ].filter(Boolean);

    if (loading && !stats) {
        return <DashboardInitialSkeleton />;
    }

    if (error && !stats) {
        return <DashboardErrorState error={error} isRetrying={isRetrying} onRetry={handleRetry} />;
    }

    return (
        <div className="space-y-8">
            {refreshError && (
                <Alert
                    type="warning"
                    title="Refresh background gagal"
                    message={`Data terbaru belum bisa diambil. Update valid terakhir: ${formatLastUpdate(lastSuccessfulUpdate)}`}
                    dismissible
                    onDismiss={() => setRefreshError(false)}
                    className="mb-4"
                />
            )}

            {stats && !stats.mtxConnected && <MediaServerWarning />}

            <DashboardHeader
                stats={stats}
                lastSuccessfulUpdate={lastSuccessfulUpdate}
                isRetrying={isRetrying}
                onRefresh={() => loadStats({ mode: 'initial' })}
                onNavigate={navigate}
            />

            <DateRangeSelector value={dateRange} onChange={setDateRange} />
            <QuickStatsCards dateRange={dateRange} />
            <DashboardAttentionItems items={attentionItems} />

            <DashboardSummaryCards
                stats={stats}
                cpuLoad={cpuLoad}
                memUsed={memUsed}
                memPercent={memPercent}
                formatBytes={formatBytes}
                onOpenViewer={setViewerModal}
            />

            <CameraStatusOverview
                breakdown={stats?.cameraStatusBreakdown}
                totalCameras={stats?.summary.totalCameras || 0}
            />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
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
