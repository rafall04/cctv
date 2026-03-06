export function formatDuration(seconds) {
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

export function formatWatchTime(seconds) {
    if (!seconds) return '0m';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

export function formatDate(dateStr, options = {}) {
    const date = new Date(dateStr);
    const { year, ...restOptions } = options;
    return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: year ? 'numeric' : undefined,
        ...restOptions,
    });
}

export function mapPeriodToApi(period, customDate) {
    if (period === 'custom') {
        return `date:${customDate}`;
    }
    return period;
}

function normalizeSession(session) {
    const deviceType = session.device_type || session.deviceType || 'desktop';
    const cameraName = session.camera_name || session.cameraName || '-';
    const durationSeconds = session.duration_seconds ?? session.durationSeconds ?? 0;

    return {
        ...session,
        device_type: deviceType,
        deviceType,
        camera_name: cameraName,
        cameraName,
        duration_seconds: durationSeconds,
        durationSeconds,
        ip_address: session.ip_address || session.ipAddress || '-',
        ipAddress: session.ip_address || session.ipAddress || '-',
    };
}

function normalizeTopCamera(camera) {
    return {
        ...camera,
        camera_id: camera.camera_id ?? camera.cameraId,
        camera_name: camera.camera_name || camera.cameraName || '-',
        total_watch_time: camera.total_watch_time ?? camera.totalWatchTime ?? 0,
        total_views: camera.total_views ?? camera.totalViews ?? 0,
        unique_viewers: camera.unique_viewers ?? camera.uniqueViewers ?? 0,
    };
}

function normalizeDevice(device) {
    return {
        ...device,
        device_type: device.device_type || device.deviceType || 'desktop',
        count: device.count ?? 0,
        percentage: device.percentage ?? 0,
    };
}

function normalizeVisitor(visitor) {
    return {
        ...visitor,
        ip_address: visitor.ip_address || visitor.ipAddress || '-',
        total_sessions: visitor.total_sessions ?? visitor.totalSessions ?? 0,
        cameras_watched: visitor.cameras_watched ?? visitor.camerasWatched ?? 0,
        total_watch_time: visitor.total_watch_time ?? visitor.totalWatchTime ?? 0,
    };
}

function normalizePeakHour(peak) {
    return {
        ...peak,
        hour: peak.hour ?? 0,
        sessions: peak.sessions ?? 0,
        unique_visitors: peak.unique_visitors ?? peak.uniqueVisitors ?? 0,
    };
}

export function normalizeAnalyticsData(data = {}, realtimeData = null) {
    const activeSessions = realtimeData?.activeSessions || realtimeData?.data?.activeSessions || data.activeSessions || [];

    return {
        ...data,
        recentSessions: (data.recentSessions || []).map(normalizeSession),
        activeSessions: activeSessions.map(normalizeSession),
        topCameras: (data.topCameras || []).map(normalizeTopCamera),
        deviceBreakdown: (data.deviceBreakdown || []).map(normalizeDevice),
        topVisitors: (data.topVisitors || []).map(normalizeVisitor),
        peakHours: (data.peakHours || []).map(normalizePeakHour),
        cameraPerformance: data.cameraPerformance || [],
        charts: data.charts || {},
        overview: data.overview || {},
        comparison: data.comparison || {},
        retention: data.retention || null,
    };
}

export function exportToCSV(data, filename) {
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map((row) => headers.map((header) => {
            const value = row[header];
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        }).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}
