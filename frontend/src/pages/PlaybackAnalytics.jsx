import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminService } from '../services/adminService';
import { cameraService } from '../services/cameraService';
import { REQUEST_POLICY } from '../services/requestPolicy';
import { formatDuration, formatWatchTime } from '../utils/admin/viewerAnalyticsAdapter';
import { useAdminReconnectRefresh } from '../hooks/admin/useAdminReconnectRefresh';

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

function StatCard({ label, value, tone = 'blue' }) {
    const tones = {
        blue: 'from-blue-500/10 to-cyan-500/10 border-blue-200 dark:border-blue-900/60',
        emerald: 'from-emerald-500/10 to-teal-500/10 border-emerald-200 dark:border-emerald-900/60',
        amber: 'from-amber-500/10 to-orange-500/10 border-amber-200 dark:border-amber-900/60',
        violet: 'from-violet-500/10 to-fuchsia-500/10 border-violet-200 dark:border-violet-900/60',
    };

    return (
        <div className={`rounded-2xl border bg-gradient-to-br ${tones[tone]} bg-white dark:bg-gray-900 p-5`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
        </div>
    );
}

export default function PlaybackAnalytics() {
    const [period, setPeriod] = useState('7days');
    const [cameraId, setCameraId] = useState('');
    const [accessMode, setAccessMode] = useState('');
    const [analytics, setAnalytics] = useState(null);
    const [activeSessions, setActiveSessions] = useState([]);
    const [cameraOptions, setCameraOptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastUpdate, setLastUpdate] = useState(null);
    const requestIdRef = useRef(0);

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
        const intervalId = setInterval(() => {
            loadAnalytics('background');
        }, 30000);

        return () => clearInterval(intervalId);
    }, [loadAnalytics]);

    useAdminReconnectRefresh(() => loadAnalytics('resume'));

    const accessBreakdown = analytics?.accessBreakdown || [];
    const topCameras = analytics?.topCameras || [];
    const topSegments = analytics?.topSegments || [];
    const recentSessions = analytics?.recentSessions || [];
    const overview = analytics?.overview || {};
    const breakdownMap = useMemo(() => {
        return accessBreakdown.reduce((accumulator, item) => {
            accumulator[item.playback_access_mode] = item.count;
            return accumulator;
        }, {});
    }, [accessBreakdown]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Playback Analytics</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Pantau siapa yang menonton playback publik dan admin secara terpisah dari live.
                    </p>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                    Update terakhir: {lastUpdate ? lastUpdate.toLocaleTimeString('id-ID') : '-'}
                </div>
            </div>

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

            {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                </div>
            )}

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

            <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Viewer Playback Aktif</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{activeSessions.length} sesi aktif</p>
                    </div>
                </div>

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
                                    <div>Durasi: {formatDuration(session.duration_seconds || session.durationSeconds || 0)}</div>
                                    {(session.admin_username || session.adminUsername) && (
                                        <div>Admin: {session.admin_username || session.adminUsername}</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
                <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Top Kamera Playback</h2>
                    <div className="mt-4 overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="text-left text-gray-500 dark:text-gray-400">
                                    <th className="pb-3">Kamera</th>
                                    <th className="pb-3">Sesi</th>
                                    <th className="pb-3">Unique</th>
                                    <th className="pb-3">Watch Time</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {topCameras.map((camera) => (
                                    <tr key={`${camera.camera_id}-${camera.camera_name}`}>
                                        <td className="py-3 text-gray-900 dark:text-white">{camera.camera_name}</td>
                                        <td className="py-3 text-gray-600 dark:text-gray-300">{camera.total_sessions}</td>
                                        <td className="py-3 text-gray-600 dark:text-gray-300">{camera.unique_viewers}</td>
                                        <td className="py-3 text-gray-600 dark:text-gray-300">{formatWatchTime(camera.total_watch_time)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {topCameras.length === 0 && <div className="py-6 text-sm text-gray-500 dark:text-gray-400">Belum ada data kamera playback.</div>}
                    </div>
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Top Segment Playback</h2>
                    <div className="mt-4 overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="text-left text-gray-500 dark:text-gray-400">
                                    <th className="pb-3">Segment</th>
                                    <th className="pb-3">Akses</th>
                                    <th className="pb-3">Sesi</th>
                                    <th className="pb-3">Watch Time</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {topSegments.map((segment) => (
                                    <tr key={`${segment.camera_id}-${segment.segment_filename}-${segment.playback_access_mode}`}>
                                        <td className="py-3 text-gray-900 dark:text-white">
                                            <div>{segment.camera_name}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{segment.segment_filename}</div>
                                        </td>
                                        <td className="py-3 text-gray-600 dark:text-gray-300">{segment.playback_access_mode}</td>
                                        <td className="py-3 text-gray-600 dark:text-gray-300">{segment.total_sessions}</td>
                                        <td className="py-3 text-gray-600 dark:text-gray-300">{formatWatchTime(segment.total_watch_time)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {topSegments.length === 0 && <div className="py-6 text-sm text-gray-500 dark:text-gray-400">Belum ada data segment playback.</div>}
                    </div>
                </section>
            </div>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Riwayat Playback Terbaru</h2>
                <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left text-gray-500 dark:text-gray-400">
                                <th className="pb-3">Kamera</th>
                                <th className="pb-3">Segment</th>
                                <th className="pb-3">Akses</th>
                                <th className="pb-3">Viewer</th>
                                <th className="pb-3">Durasi</th>
                                <th className="pb-3">Mulai</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {recentSessions.map((session) => (
                                <tr key={session.id}>
                                    <td className="py-3 text-gray-900 dark:text-white">{session.camera_name}</td>
                                    <td className="py-3 text-gray-600 dark:text-gray-300">{session.segment_filename}</td>
                                    <td className="py-3 text-gray-600 dark:text-gray-300">{session.playback_access_mode}</td>
                                    <td className="py-3 text-gray-600 dark:text-gray-300">
                                        <div>{session.ip_address}</div>
                                        {session.admin_username && (
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{session.admin_username}</div>
                                        )}
                                    </td>
                                    <td className="py-3 text-gray-600 dark:text-gray-300">{formatDuration(session.duration_seconds)}</td>
                                    <td className="py-3 text-gray-600 dark:text-gray-300">{new Date(session.started_at).toLocaleString('id-ID')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {recentSessions.length === 0 && <div className="py-6 text-sm text-gray-500 dark:text-gray-400">Belum ada riwayat playback.</div>}
                </div>
            </section>
        </div>
    );
}
