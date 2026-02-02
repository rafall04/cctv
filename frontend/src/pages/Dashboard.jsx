import { useState, useEffect, useRef, useCallback } from 'react';
import { adminService } from '../services/adminService';
import { Link, useNavigate } from 'react-router-dom';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState, NoStreamsEmptyState, NoActivityEmptyState } from '../components/ui/EmptyState';
import { Alert } from '../components/ui/Alert';
import { useNotification } from '../contexts/NotificationContext';
import { CameraStatusOverview } from '../components/CameraStatusOverview';
import { QuickStatsCards } from '../components/QuickStatsCards';
import { TopCamerasWidget } from '../components/TopCamerasWidget';
import { DateRangeSelector } from '../components/DateRangeSelector';

/**
 * Viewer Sessions Modal - Shows list of viewers with IP addresses
 */
function ViewerSessionsModal({ title, sessions, onClose }) {
    const formatDuration = (seconds) => {
        if (!seconds || seconds < 60) return `${seconds || 0}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins < 60) return `${mins}m ${secs}s`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ${mins % 60}m`;
    };

    const getDeviceIcon = (type) => {
        if (type === 'mobile') return (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
        );
        if (type === 'tablet') return (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
        );
        return (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
            <div 
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
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
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="overflow-y-auto max-h-[60vh]">
                    {sessions.length === 0 ? (
                        <div className="p-8 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
                                        {/* Device Icon */}
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                            session.deviceType === 'mobile' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-500' :
                                            session.deviceType === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-500' :
                                            'bg-gray-100 dark:bg-gray-700 text-gray-500'
                                        }`}>
                                            {getDeviceIcon(session.deviceType)}
                                        </div>
                                        
                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">
                                                    {session.ipAddress}
                                                </span>
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                    session.deviceType === 'mobile' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                                                    session.deviceType === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400' :
                                                    'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                                }`}>
                                                    {session.deviceType || 'desktop'}
                                                </span>
                                            </div>
                                            {session.cameraName && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                    📹 {session.cameraName}
                                                </p>
                                            )}
                                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                                                <span>⏱️ {formatDuration(session.durationSeconds)}</span>
                                                {session.startedAt && (
                                                    <span>
                                                        Mulai: {new Date(session.startedAt).toLocaleTimeString('id-ID', { 
                                                            hour: '2-digit', 
                                                            minute: '2-digit' 
                                                        })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        
                                        {/* Live indicator */}
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

/**
 * Dashboard Skeleton Components
 * Requirements: 3.4, 8.1, 8.2, 8.3, 8.4, 8.5
 */

// Skeleton for stats grid
function DashboardStatsSkeleton() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <Skeleton variant="rectangular" className="w-12 h-12 rounded-xl" />
                        <Skeleton variant="text" className="h-3 w-16" />
                    </div>
                    <Skeleton variant="text" className="h-9 w-16 mb-2" />
                    <Skeleton variant="text" className="h-4 w-24" />
                </div>
            ))}
        </div>
    );
}

// Skeleton for streams table
function DashboardStreamsSkeleton() {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/50">
                            <th className="px-6 py-4 text-left"><Skeleton variant="text" className="h-3 w-16" /></th>
                            <th className="px-6 py-4 text-left"><Skeleton variant="text" className="h-3 w-12" /></th>
                            <th className="px-6 py-4 text-center"><Skeleton variant="text" className="h-3 w-14 mx-auto" /></th>
                            <th className="px-6 py-4 text-right"><Skeleton variant="text" className="h-3 w-16 ml-auto" /></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700/50">
                        {[1, 2, 3, 4].map((i) => (
                            <tr key={i}>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <Skeleton variant="rectangular" className="w-10 h-10 rounded-xl" />
                                        <div>
                                            <Skeleton variant="text" className="h-4 w-24 mb-1" />
                                            <Skeleton variant="text" className="h-3 w-16" />
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4"><Skeleton variant="text" className="h-6 w-14 rounded-lg" /></td>
                                <td className="px-6 py-4 text-center"><Skeleton variant="text" className="h-6 w-10 rounded-lg mx-auto" /></td>
                                <td className="px-6 py-4 text-right">
                                    <Skeleton variant="text" className="h-4 w-16 ml-auto mb-1" />
                                    <Skeleton variant="text" className="h-3 w-14 ml-auto" />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// Skeleton for activity log
function DashboardActivitySkeleton() {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <div className="space-y-6">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex gap-4">
                        <Skeleton variant="circular" className="w-[18px] h-[18px] mt-0.5" />
                        <div className="flex-1">
                            <Skeleton variant="text" className="h-4 w-full mb-2" />
                            <div className="flex items-center gap-2">
                                <Skeleton variant="text" className="h-3 w-16" />
                                <Skeleton variant="text" className="h-3 w-24" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Skeleton for header
function DashboardHeaderSkeleton() {
    return (
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
                <Skeleton variant="text" className="h-4 w-24 mb-2" />
                <Skeleton variant="text" className="h-8 w-32 mb-2" />
                <Skeleton variant="text" className="h-4 w-48" />
            </div>
            <div className="flex items-center gap-3">
                <Skeleton variant="rectangular" className="h-14 w-24 rounded-xl" />
                <Skeleton variant="rectangular" className="h-14 w-36 rounded-xl" />
            </div>
        </div>
    );
}

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [viewerModal, setViewerModal] = useState(null); // { title, sessions }
    const [lastSuccessfulUpdate, setLastSuccessfulUpdate] = useState(null);
    const [refreshError, setRefreshError] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [dateRange, setDateRange] = useState('today'); // Date range filter
    const intervalRef = useRef(null);
    const navigate = useNavigate();
    const { warning } = useNotification();

    const loadStats = useCallback(async (isAutoRefresh = false, period = 'today') => {
        try {
            if (!isAutoRefresh) {
                setIsRetrying(true);
            }
            const response = await adminService.getStats();
            if (response.success) {
                setStats(response.data);
                setError(null);
                setRefreshError(false);
                setLastSuccessfulUpdate(new Date());
            } else {
                if (isAutoRefresh && stats) {
                    // Auto-refresh failed but we have existing data
                    setRefreshError(true);
                } else {
                    setError(response.message || 'Failed to load dashboard data');
                }
            }
        } catch (err) {
            if (isAutoRefresh && stats) {
                // Auto-refresh failed but we have existing data
                setRefreshError(true);
            } else {
                setError('Failed to connect to server. Please check your connection.');
            }
        } finally {
            setLoading(false);
            setIsRetrying(false);
        }
    }, [stats]);

    useEffect(() => {
        loadStats(false, dateRange);
        intervalRef.current = setInterval(() => loadStats(true, dateRange), 10000);
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [dateRange]); // Re-fetch when date range changes

    const handleDateRangeChange = (range, customDates) => {
        setDateRange(range);
        setLoading(true);
        loadStats(false, range);
    };

    const handleRetry = () => {
        setError(null);
        setLoading(true);
        loadStats(false);
    };

    const handleAddCamera = () => {
        navigate('/admin/cameras');
    };

    // Show skeleton loading state on initial load
    if (loading && !stats) {
        return (
            <div className="space-y-8">
                <DashboardHeaderSkeleton />
                <DashboardStatsSkeleton />
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div className="xl:col-span-2 space-y-4">
                        <div className="flex items-center justify-between">
                            <Skeleton variant="text" className="h-6 w-28" />
                            <Skeleton variant="text" className="h-4 w-20" />
                        </div>
                        <DashboardStreamsSkeleton />
                    </div>
                    <div className="space-y-4">
                        <Skeleton variant="text" className="h-6 w-24" />
                        <DashboardActivitySkeleton />
                    </div>
                </div>
            </div>
        );
    }

    // Show error state with retry button
    if (error && !stats) {
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
                    onClick={handleRetry}
                    disabled={isRetrying}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-400 text-white font-medium rounded-lg transition-colors"
                >
                    {isRetrying ? (
                        <>
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Retrying...
                        </>
                    ) : (
                        <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Retry
                        </>
                    )}
                </button>
            </div>
        );
    }

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatUptime = (seconds) => {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    };

    const formatLastUpdate = (date) => {
        if (!date) return 'Never';
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return date.toLocaleTimeString();
    };

    const cpuLoad = stats?.system?.cpuLoad ?? 0;
    const memUsed = stats?.system?.totalMem - stats?.system?.freeMem;
    const memPercent = Math.round((memUsed / stats?.system?.totalMem) * 100);

    return (
        <div className="space-y-8">
            {/* Auto-refresh failure warning - Requirements: 3.7 */}
            {refreshError && (
                <Alert
                    type="warning"
                    title="Auto-refresh failed"
                    message={`Unable to fetch latest data. Last successful update: ${formatLastUpdate(lastSuccessfulUpdate)}`}
                    dismissible
                    onDismiss={() => setRefreshError(false)}
                    className="mb-4"
                />
            )}

            {/* MediaMTX Offline Warning Banner - Requirements: 3.2 */}
            {stats && !stats.mtxConnected && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-10 h-10 bg-red-100 dark:bg-red-500/20 rounded-lg flex items-center justify-center text-red-500">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <div className="flex-1">
                            <h3 className="text-sm font-semibold text-red-800 dark:text-red-400">MediaMTX Server Offline</h3>
                            <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                                The media streaming server is not responding. Live streams will be unavailable until the connection is restored.
                            </p>
                            <p className="text-xs text-red-500 dark:text-red-400 mt-2">
                                Tip: Check if MediaMTX is running on port 9997 and restart if necessary.
                            </p>
                        </div>
                    </div>
                </div>
            )}
            {/* Header - Reorganized for better clarity */}
            <div className="space-y-6">
                {/* Title Section */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <p className="text-sm font-semibold text-sky-500">System Overview</p>
                            {lastSuccessfulUpdate && (
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                    • Updated {formatLastUpdate(lastSuccessfulUpdate)}
                                </span>
                            )}
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Monitoring {stats?.summary.totalCameras} cameras across {stats?.summary.totalAreas} areas
                        </p>
                    </div>
                    
                    {/* Refresh Button - Standalone */}
                    <button
                        onClick={() => loadStats(false)}
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

                {/* Quick Actions Only */}
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={() => navigate('/admin/cameras')}
                        className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-sky-500/25 hover:shadow-xl hover:shadow-sky-500/30 transition-all"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        <span>Tambah Kamera</span>
                    </button>
                    
                    <button
                        onClick={() => navigate('/admin/analytics')}
                        className="inline-flex items-center gap-2 px-5 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        <span>Analytics</span>
                    </button>

                    <button
                        onClick={() => navigate('/admin/settings')}
                        className="inline-flex items-center gap-2 px-5 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span>Settings</span>
                    </button>
                </div>
            </div>

            {/* Date Range Selector */}
            <DateRangeSelector 
                value={dateRange} 
                onChange={handleDateRangeChange}
            />

            {/* Quick Stats Mini Cards - Phase 2 */}
            <QuickStatsCards dateRange={dateRange} />

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Cameras */}
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg hover:border-sky-500/30 transition-all group">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-sky-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-sky-500/30 group-hover:scale-110 transition-transform">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Cameras</span>
                    </div>
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{stats?.summary.totalCameras}</h3>
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 rounded-lg">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            {stats?.cameraStatusBreakdown?.online || 0} Online
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{stats?.cameraStatusBreakdown?.offline || 0} Offline</span>
                    </div>
                </div>

                {/* Viewers - Clickable to show all sessions */}
                <div 
                    className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg hover:border-purple-500/30 transition-all group cursor-pointer"
                    onClick={() => setViewerModal({ 
                        title: 'Semua Viewer Aktif', 
                        sessions: stats?.allSessions || [] 
                    })}
                >
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-purple-500/30 group-hover:scale-110 transition-transform">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Viewers</span>
                    </div>
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{stats?.summary.activeViewers}</h3>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Klik untuk lihat detail</p>
                </div>

                {/* Memory */}
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg hover:border-blue-500/30 transition-all group">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30 group-hover:scale-110 transition-transform">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Memory</span>
                    </div>
                    <div className="flex items-baseline gap-2 mb-3">
                        <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{memPercent}%</h3>
                        <span className="text-xs text-gray-400 dark:text-gray-500">Used</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all" style={{ width: `${memPercent}%` }}></div>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{formatBytes(memUsed)} / {formatBytes(stats?.system.totalMem)}</p>
                </div>

                {/* CPU */}
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg hover:border-amber-500/30 transition-all group">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-amber-500/30 group-hover:scale-110 transition-transform">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">CPU</span>
                    </div>
                    <div className="flex items-baseline gap-2 mb-3">
                        <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{cpuLoad}%</h3>
                        <span className="text-xs text-gray-400 dark:text-gray-500">Load</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all" style={{ width: `${cpuLoad}%` }}></div>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 truncate" title={stats?.system.cpuModel}>{stats?.system.cpuModel || 'Unknown'}</p>
                </div>
            </div>

            {/* Phase 1: Camera Status Overview (Full Width) */}
            <CameraStatusOverview 
                breakdown={stats?.cameraStatusBreakdown}
                totalCameras={stats?.summary.totalCameras || 0}
            />

            {/* Content Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Enhanced Live Streams Table */}
                <div className="xl:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Live Streams</h2>
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                                Sorted by viewers
                            </span>
                            <Link to="/admin/cameras" className="text-sm font-semibold text-sky-500 hover:text-sky-600 transition-colors flex items-center gap-1">
                                Manage All
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                            </Link>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
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
                                                    <p className="font-semibold text-gray-900 dark:text-white">Media Server Offline</p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">Unable to fetch stream statistics</p>
                                                    <button
                                                        onClick={handleRetry}
                                                        className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 transition-colors"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                        </svg>
                                                        Retry Connection
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : stats?.streams.length === 0 ? (
                                        <tr>
                                            <td colSpan="4" className="px-6 py-8">
                                                {/* No streams empty state - Requirements: 3.5 */}
                                                <NoStreamsEmptyState onAddCamera={handleAddCamera} />
                                            </td>
                                        </tr>
                                    ) : (
                                        // Sort streams by viewers (descending)
                                        [...stats.streams]
                                            .sort((a, b) => b.viewers - a.viewers)
                                            .map((stream, idx) => {
                                                // Determine rank badge for top 3
                                                const isTop3 = idx < 3 && stream.viewers > 0;
                                                const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                                                
                                                return (
                                                    <tr key={stream.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                {/* Rank Badge for Top 3 */}
                                                                {isTop3 && (
                                                                    <span className="text-xl" title={`Rank #${idx + 1}`}>
                                                                        {rankBadge}
                                                                    </span>
                                                                )}
                                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                                                    isTop3 
                                                                        ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30' 
                                                                        : 'bg-gray-100 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500'
                                                                }`}>
                                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                                    </svg>
                                                                </div>
                                                                <div>
                                                                    <p className="font-semibold text-gray-900 dark:text-white">{stream.name}</p>
                                                                    <p className="text-xs text-gray-400 dark:text-gray-500">ID: {stream.id}</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                                                                stream.state === 'ready' 
                                                                    ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                                                                    : 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                                            }`}>
                                                                {stream.state}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-center">
                                                            <button
                                                                onClick={() => setViewerModal({
                                                                    title: `Viewer - ${stream.name}`,
                                                                    sessions: stream.sessions || []
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
                                                            <p className="text-sm font-semibold text-sky-500">↑ {formatBytes(stream.bytesSent)}</p>
                                                            <p className="text-xs text-gray-400 dark:text-gray-500">↓ {formatBytes(stream.bytesReceived)}</p>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Sidebar: Top Cameras & Activity Log */}
                <div className="space-y-6">
                    {/* Top Cameras Widget - Phase 2 */}
                    <TopCamerasWidget cameras={stats?.topCameras || []} />

                    {/* Activity Log */}
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Activity Log</h2>
                        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                        <div className="space-y-6">
                            {stats?.recentLogs.length === 0 ? (
                                /* No activity logs empty state - Requirements: 3.5 */
                                <NoActivityEmptyState />
                            ) : (
                                stats?.recentLogs.map((log, idx) => (
                                    <div key={log.id} className="relative flex gap-4">
                                        {idx !== stats.recentLogs.length - 1 && (
                                            <div className="absolute left-[9px] top-6 bottom-[-24px] w-px bg-gray-200 dark:bg-gray-700"></div>
                                        )}
                                        <div className={`relative z-10 w-[18px] h-[18px] rounded-full mt-0.5 border-4 border-white dark:border-gray-800 ${
                                            log.action.includes('CREATE') ? 'bg-emerald-500' :
                                            log.action.includes('DELETE') ? 'bg-red-500' : 'bg-sky-500'
                                        }`}></div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white">{log.details}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs text-gray-500 dark:text-gray-400">{log.username}</span>
                                                <span className="text-xs text-gray-300 dark:text-gray-600">•</span>
                                                <span className="text-xs text-sky-500 font-medium">{log.created_at_wib}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* System Health */}
                    <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-500/5 dark:to-blue-500/5 border border-sky-200/50 dark:border-sky-500/20 rounded-2xl p-6">
                        <h4 className="text-sm font-bold text-sky-600 dark:text-sky-400 mb-4 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            System Health
                        </h4>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Database</span>
                                </div>
                                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10 px-2 py-0.5 rounded-lg">Optimal</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${stats?.mtxConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Media Server</span>
                                </div>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${stats?.mtxConnected ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10' : 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/10'}`}>
                                    {stats?.mtxConnected ? 'Stable' : 'Offline'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                    <span className="text-sm text-gray-700 dark:text-gray-300">API Gateway</span>
                                </div>
                                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10 px-2 py-0.5 rounded-lg">Online</span>
                            </div>
                        </div>
                    </div>
                    </div>
                </div>
            </div>

            {/* Viewer Sessions Modal */}
            {viewerModal && (
                <ViewerSessionsModal
                    title={viewerModal.title}
                    sessions={viewerModal.sessions}
                    onClose={() => setViewerModal(null)}
                />
            )}
        </div>
    );
}
