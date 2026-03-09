function parseValidDate(timestamp) {
    if (!timestamp) return null;
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTimestamp(timestamp) {
    const parsed = parseValidDate(timestamp);
    if (!parsed) return '-';

    return parsed.toLocaleString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatReason(reason) {
    const labels = {
        process_crashed: 'Proses Crash',
        stream_frozen: 'Stream Beku',
        timeout: 'Timeout',
        manual: 'Manual',
    };

    return labels[reason] || reason?.replace(/_/g, ' ') || '-';
}

function getReasonTone(reason) {
    if (reason === 'stream_frozen' || reason === 'timeout') {
        return 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100';
    }

    return 'bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-100';
}

function getStatusInfo(success, recoveryTime) {
    const hasRecoveryTime = !!parseValidDate(recoveryTime);

    if (success) {
        return {
            label: hasRecoveryTime ? 'Pulih' : 'Sukses',
            className: 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100',
        };
    }

    return {
        label: 'Belum Pulih',
        className: 'bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-100',
    };
}

function formatRecoveryDuration(restartTime, recoveryTime) {
    const restartDate = parseValidDate(restartTime);
    const recoveryDate = parseValidDate(recoveryTime);

    if (!restartDate || !recoveryDate) return null;

    const diffMs = recoveryDate.getTime() - restartDate.getTime();
    if (diffMs < 0) return null;

    const totalSeconds = Math.round(diffMs / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds} detik`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
        return seconds > 0 ? `${minutes} menit ${seconds} detik` : `${minutes} menit`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours} jam ${remainingMinutes} menit` : `${hours} jam`;
}

function renderRecovery(log) {
    const recoveryLabel = formatTimestamp(log.recovery_time);
    const duration = formatRecoveryDuration(log.restart_time, log.recovery_time);

    if (recoveryLabel === '-') {
        return (
                <div className="text-sm text-gray-600 dark:text-gray-300">
                    {log.success ? 'Belum tersedia' : 'Belum pulih'}
                </div>
            );
    }

    return (
        <div>
                <div className="text-sm text-gray-700 dark:text-gray-200">{recoveryLabel}</div>
            {duration && (
                <div className="text-xs text-gray-600 dark:text-gray-300">Pulih dalam {duration}</div>
            )}
        </div>
    );
}

export default function RecordingRestartLogs({ logs }) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-800/70 md:p-6">
            <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">Auto-Restart Logs</h2>

            {logs.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Camera</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Reason</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Restart</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Recovery</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.slice(0, 20).map((log, index) => (
                                <tr key={`${log.camera_name}-${log.restart_time || log.recovery_time || index}-${index}`} className="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-700/40">
                                    <td className="px-4 py-3 text-gray-900 dark:text-white">{log.camera_name}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs ${
                                            getReasonTone(log.reason)
                                        }`}>
                                            {formatReason(log.reason)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusInfo(log.success, log.recovery_time).className}`}>
                                            {getStatusInfo(log.success, log.recovery_time).label}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">{formatTimestamp(log.restart_time)}</td>
                                    <td className="px-4 py-3">{renderRecovery(log)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="py-8 text-center text-gray-600 dark:text-gray-300">Belum ada restart logs</p>
            )}
        </div>
    );
}
