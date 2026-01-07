import { useState, useEffect, useRef, useCallback } from 'react';
import { adminService } from '../services/adminService';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Alert } from '../components/ui/Alert';

/**
 * Format duration in seconds to human readable format
 */
function formatDuration(seconds) {
    if (!seconds || seconds < 60) return `${seconds || 0}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (hours < 24) return `${hours}h ${remainingMins}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}

/**
 * Format watch time in seconds to hours/minutes
 */
function formatWatchTime(seconds) {
    if (!seconds) return '0m';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

/**
 * Get device icon based on type
 */
function DeviceIcon({ type, className = "w-4 h-4" }) {
    if (type === 'mobile') return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
    );
    if (type === 'tablet') return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
    );
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
    );
}

/**
 * Simple Bar Chart Component
 */
function SimpleBarChart({ data, maxValue, label }) {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500">
                Tidak ada data
            </div>
        );
    }

    const max = maxValue || Math.max(...data.map(d => d.value), 1);

    return (
        <div className="space-y-2">
            {data.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-16 text-right truncate">
                        {item.label}
                    </span>
                    <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
                        <div 
                            className="h-full bg-gradient-to-r from-sky-500 to-blue-600 rounded-lg transition-all duration-500"
                            style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
                        />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-12">
                        {item.value}
                    </span>
                </div>
            ))}
        </div>
    );
}

/**
 * Stats Card Component
 */
function StatsCard({ icon, label, value, subValue, color = 'sky', onClick }) {
    const colorClasses = {
        sky: 'from-sky-400 to-sky-600 shadow-sky-500/30',
        purple: 'from-purple-400 to-purple-600 shadow-purple-500/30',
        emerald: 'from-emerald-400 to-emerald-600 shadow-emerald-500/30',
        amber: 'from-amber-400 to-amber-600 shadow-amber-500/30',
        rose: 'from-rose-400 to-rose-600 shadow-rose-500/30',
    };

    return (
        <div 
            className={`bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg transition-all group ${onClick ? 'cursor-pointer hover:border-sky-500/30' : ''}`}
            onClick={onClick}
        >
            <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 bg-gradient-to-br ${colorClasses[color]} rounded-xl flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}>
                    {icon}
                </div>
                <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{value}</h3>
            {subValue && (
                <p className="text-sm text-gray-500 dark:text-gray-400">{subValue}</p>
            )}
        </div>
    );
}

/**
 * Period Selector Component
 */
function PeriodSelector({ value, onChange }) {
    const periods = [
        { value: 'today', label: 'Hari Ini' },
        { value: '7days', label: '7 Hari' },
        { value: '30days', label: '30 Hari' },
        { value: 'all', label: 'Semua' },
    ];

    return (
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            {periods.map(period => (
                <button
                    key={period.value}
                    onClick={() => onChange(period.value)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                        value === period.value
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                >
                    {period.label}
                </button>
            ))}
        </div>
    );
}

/**
 * Active Viewer Card
 */
function ActiveViewerCard({ session }) {
    return (
        <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                session.deviceType === 'mobile' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-500' :
                session.deviceType === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-500' :
                'bg-gray-100 dark:bg-gray-700 text-gray-500'
            }`}>
                <DeviceIcon type={session.deviceType} className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {session.ipAddress}
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">LIVE</span>
                    </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    📹 {session.cameraName} • ⏱️ {formatDuration(session.durationSeconds)}
                </p>
            </div>
        </div>
    );
}

/**
 * Skeleton Components for Loading State
 */
function AnalyticsSkeleton() {
    return (
        <div className="space-y-8">
            {/* Header Skeleton */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <Skeleton variant="text" className="h-4 w-24 mb-2" />
                    <Skeleton variant="text" className="h-8 w-48 mb-2" />
                    <Skeleton variant="text" className="h-4 w-64" />
                </div>
                <Skeleton variant="rectangular" className="h-10 w-64 rounded-xl" />
            </div>

            {/* Stats Grid Skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <Skeleton variant="rectangular" className="w-12 h-12 rounded-xl" />
                            <Skeleton variant="text" className="h-3 w-16" />
                        </div>
                        <Skeleton variant="text" className="h-9 w-20 mb-2" />
                        <Skeleton variant="text" className="h-4 w-32" />
                    </div>
                ))}
            </div>

            {/* Charts Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <Skeleton variant="text" className="h-6 w-40 mb-4" />
                    <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="flex items-center gap-3">
                                <Skeleton variant="text" className="h-4 w-16" />
                                <Skeleton variant="rectangular" className="h-6 flex-1 rounded-lg" />
                                <Skeleton variant="text" className="h-4 w-12" />
                            </div>
                        ))}
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <Skeleton variant="text" className="h-6 w-40 mb-4" />
                    <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map(i => (
                            <Skeleton key={i} variant="rectangular" className="h-12 w-full rounded-xl" />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Main ViewerAnalytics Component
 */
export default function ViewerAnalytics() {
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [period, setPeriod] = useState('7days');
    const [refreshError, setRefreshError] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(null);
    const intervalRef = useRef(null);

    const loadAnalytics = useCallback(async (isAutoRefresh = false) => {
        try {
            const response = await adminService.getViewerAnalytics(period);
            if (response.success) {
                setAnalytics(response.data);
                setError(null);
                setRefreshError(false);
                setLastUpdate(new Date());
            } else {
                if (isAutoRefresh && analytics) {
                    setRefreshError(true);
                } else {
                    setError(response.message || 'Gagal memuat data analytics');
                }
            }
        } catch (err) {
            if (isAutoRefresh && analytics) {
                setRefreshError(true);
            } else {
                setError('Gagal terhubung ke server');
            }
        } finally {
            setLoading(false);
        }
    }, [period, analytics]);

    useEffect(() => {
        setLoading(true);
        loadAnalytics(false);
    }, [period]);

    useEffect(() => {
        intervalRef.current = setInterval(() => loadAnalytics(true), 30000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [loadAnalytics]);

    const handleRetry = () => {
        setError(null);
        setLoading(true);
        loadAnalytics(false);
    };

    // Loading state
    if (loading && !analytics) {
        return <AnalyticsSkeleton />;
    }

    // Error state
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
                <button onClick={handleRetry} className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-medium rounded-lg transition-colors">
                    Coba Lagi
                </button>
            </div>
        );
    }

    const { overview, charts, topCameras, deviceBreakdown, topVisitors, recentSessions, peakHours, activeSessions } = analytics || {};

    // Prepare chart data
    const sessionsByDayData = (charts?.sessionsByDay || []).slice(-7).map(d => ({
        label: new Date(d.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' }),
        value: d.sessions
    }));

    const hourlyData = (charts?.sessionsByHour || []).map(h => ({
        label: `${h.hour}:00`,
        value: h.sessions
    }));

    return (
        <div className="space-y-8">
            {/* Refresh Error Alert */}
            {refreshError && (
                <Alert
                    type="warning"
                    title="Auto-refresh gagal"
                    message={`Tidak dapat memuat data terbaru. Update terakhir: ${lastUpdate?.toLocaleTimeString('id-ID') || '-'}`}
                    dismissible
                    onDismiss={() => setRefreshError(false)}
                />
            )}

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-500 mb-1">Viewer Analytics</p>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Statistik Penonton</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Analisis pengunjung dan aktivitas streaming
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {lastUpdate && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                            Update: {lastUpdate.toLocaleTimeString('id-ID')}
                        </span>
                    )}
                    <PeriodSelector value={period} onChange={setPeriod} />
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                <StatsCard
                    icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                    label="Aktif Sekarang"
                    value={overview?.activeViewers || 0}
                    subValue="viewer sedang menonton"
                    color="emerald"
                />
                <StatsCard
                    icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
                    label="Pengunjung Unik"
                    value={overview?.uniqueVisitors || 0}
                    subValue={`${overview?.totalSessions || 0} total sesi`}
                    color="purple"
                />
                <StatsCard
                    icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                    label="Total Watch Time"
                    value={formatWatchTime(overview?.totalWatchTime || 0)}
                    subValue={`Rata-rata ${formatDuration(overview?.avgSessionDuration || 0)}/sesi`}
                    color="sky"
                />
                <StatsCard
                    icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
                    label="Sesi Terlama"
                    value={formatDuration(overview?.longestSession || 0)}
                    subValue="durasi terlama"
                    color="amber"
                />
            </div>

            {/* Active Viewers Section */}
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
                        {activeSessions.map((session, idx) => (
                            <ActiveViewerCard key={session.sessionId || idx} session={session} />
                        ))}
                    </div>
                </div>
            )}

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Sessions by Day */}
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Sesi per Hari</h2>
                    {sessionsByDayData.length > 0 ? (
                        <SimpleBarChart data={sessionsByDayData} />
                    ) : (
                        <EmptyState
                            iconType="activity"
                            title="Belum ada data"
                            description="Data sesi akan muncul setelah ada pengunjung"
                        />
                    )}
                </div>

                {/* Sessions by Hour */}
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Aktivitas per Jam</h2>
                    {hourlyData.length > 0 ? (
                        <SimpleBarChart data={hourlyData} />
                    ) : (
                        <EmptyState
                            iconType="activity"
                            title="Belum ada data"
                            description="Data aktivitas akan muncul setelah ada pengunjung"
                        />
                    )}
                </div>
            </div>

            {/* Top Cameras & Device Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Cameras */}
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Kamera Terpopuler</h2>
                    {topCameras && topCameras.length > 0 ? (
                        <div className="space-y-3">
                            {topCameras.slice(0, 5).map((camera, idx) => (
                                <div key={camera.camera_id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm ${
                                        idx === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-600' :
                                        idx === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-500' :
                                        idx === 2 ? 'bg-gradient-to-br from-orange-400 to-orange-600' :
                                        'bg-gray-400 dark:bg-gray-600'
                                    }`}>
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-gray-900 dark:text-white truncate">{camera.camera_name}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {camera.total_views} views • {camera.unique_viewers} pengunjung unik
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatWatchTime(camera.total_watch_time)}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">watch time</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            iconType="camera"
                            title="Belum ada data"
                            description="Data kamera akan muncul setelah ada pengunjung"
                        />
                    )}
                </div>

                {/* Device Breakdown */}
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Perangkat Pengunjung</h2>
                    {deviceBreakdown && deviceBreakdown.length > 0 ? (
                        <div className="space-y-4">
                            {deviceBreakdown.map(device => (
                                <div key={device.device_type} className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                                        device.device_type === 'mobile' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-500' :
                                        device.device_type === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-500' :
                                        'bg-gray-100 dark:bg-gray-700 text-gray-500'
                                    }`}>
                                        <DeviceIcon type={device.device_type} className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="font-semibold text-gray-900 dark:text-white capitalize">
                                                {device.device_type || 'Unknown'}
                                            </span>
                                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                                {device.count} ({device.percentage || 0}%)
                                            </span>
                                        </div>
                                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                            <div 
                                                className={`h-full rounded-full transition-all duration-500 ${
                                                    device.device_type === 'mobile' ? 'bg-blue-500' :
                                                    device.device_type === 'tablet' ? 'bg-purple-500' :
                                                    'bg-gray-500'
                                                }`}
                                                style={{ width: `${device.percentage || 0}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            iconType="users"
                            title="Belum ada data"
                            description="Data perangkat akan muncul setelah ada pengunjung"
                        />
                    )}
                </div>
            </div>

            {/* Top Visitors & Peak Hours */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Visitors */}
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Pengunjung Teratas</h2>
                    {topVisitors && topVisitors.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                                        <th className="pb-3">IP Address</th>
                                        <th className="pb-3 text-center">Sesi</th>
                                        <th className="pb-3 text-center">Kamera</th>
                                        <th className="pb-3 text-right">Watch Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {topVisitors.slice(0, 10).map((visitor, idx) => (
                                        <tr key={idx} className="text-sm">
                                            <td className="py-3">
                                                <span className="font-mono font-semibold text-gray-900 dark:text-white">
                                                    {visitor.ip_address}
                                                </span>
                                            </td>
                                            <td className="py-3 text-center text-gray-600 dark:text-gray-400">
                                                {visitor.total_sessions}
                                            </td>
                                            <td className="py-3 text-center text-gray-600 dark:text-gray-400">
                                                {visitor.cameras_watched}
                                            </td>
                                            <td className="py-3 text-right font-semibold text-gray-900 dark:text-white">
                                                {formatWatchTime(visitor.total_watch_time)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <EmptyState
                            iconType="users"
                            title="Belum ada data"
                            description="Data pengunjung akan muncul setelah ada aktivitas"
                        />
                    )}
                </div>

                {/* Peak Hours */}
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Jam Sibuk</h2>
                    {peakHours && peakHours.length > 0 ? (
                        <div className="space-y-3">
                            {peakHours.map((peak, idx) => (
                                <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                                        idx === 0 ? 'bg-gradient-to-br from-sky-400 to-sky-600 text-white' :
                                        'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                    }`}>
                                        {peak.hour}:00
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-semibold text-gray-900 dark:text-white">
                                            {peak.sessions} sesi
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {peak.unique_visitors} pengunjung unik
                                        </p>
                                    </div>
                                    {idx === 0 && (
                                        <span className="px-2 py-1 bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 text-xs font-medium rounded-lg">
                                            Peak
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            iconType="activity"
                            title="Belum ada data"
                            description="Data jam sibuk akan muncul setelah ada aktivitas"
                        />
                    )}
                </div>
            </div>

            {/* Recent Sessions */}
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Sesi Terbaru</h2>
                {recentSessions && recentSessions.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700">
                                    <th className="pb-3 pr-4">Kamera</th>
                                    <th className="pb-3 pr-4">IP Address</th>
                                    <th className="pb-3 pr-4">Perangkat</th>
                                    <th className="pb-3 pr-4">Mulai</th>
                                    <th className="pb-3 text-right">Durasi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {recentSessions.slice(0, 20).map((session, idx) => (
                                    <tr key={session.id || idx} className="text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                        <td className="py-3 pr-4">
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {session.camera_name}
                                            </span>
                                        </td>
                                        <td className="py-3 pr-4">
                                            <span className="font-mono text-gray-600 dark:text-gray-400">
                                                {session.ip_address}
                                            </span>
                                        </td>
                                        <td className="py-3 pr-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
                                                session.device_type === 'mobile' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                                                session.device_type === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400' :
                                                'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                            }`}>
                                                <DeviceIcon type={session.device_type} className="w-3 h-3" />
                                                {session.device_type || 'desktop'}
                                            </span>
                                        </td>
                                        <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">
                                            {new Date(session.started_at).toLocaleString('id-ID', {
                                                day: '2-digit',
                                                month: 'short',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </td>
                                        <td className="py-3 text-right font-semibold text-gray-900 dark:text-white">
                                            {formatDuration(session.duration_seconds)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <EmptyState
                        iconType="activity"
                        title="Belum ada sesi"
                        description="Riwayat sesi akan muncul setelah ada pengunjung yang menonton"
                    />
                )}
            </div>
        </div>
    );
}
