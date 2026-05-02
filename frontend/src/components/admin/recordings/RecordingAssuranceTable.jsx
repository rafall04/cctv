/*
Purpose: Render per-camera recording assurance health and diagnostic reasons for operators.
Caller: RecordingDashboard after assurance data loads.
Deps: assurance camera snapshot payload and dashboard Tailwind styles.
MainFuncs: RecordingAssuranceTable.
SideEffects: None; presentational only.
*/

function formatReason(reason) {
    const labels = {
        recording_process_down: 'Recording process down',
        no_segments_after_start: 'No segments after start',
        waiting_first_segment: 'Waiting first segment',
        segment_stale: 'Latest segment stale',
        latest_segment_empty: 'Latest segment empty',
        latest_segment_file_missing: 'Latest segment file missing',
        latest_segment_size_mismatch: 'Latest segment size mismatch',
        recent_segment_gap: 'Recent segment gap',
    };

    return labels[reason] || reason?.replace(/_/g, ' ') || '-';
}

function getHealthTone(health) {
    if (health === 'critical') {
        return 'bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-100';
    }

    if (health === 'warning') {
        return 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100';
    }

    return 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100';
}

function formatSeconds(seconds) {
    if (seconds == null) {
        return '-';
    }

    if (seconds < 60) {
        return `${seconds} detik`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
        return remainingSeconds > 0 ? `${minutes} menit ${remainingSeconds} detik` : `${minutes} menit`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours} jam ${remainingMinutes} menit` : `${hours} jam`;
}

export default function RecordingAssuranceTable({ cameras = [] }) {
    if (!cameras.length) {
        return (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-800/70 md:p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Recording Assurance</h2>
                <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">Belum ada kamera recording yang dipantau.</p>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-800/70 md:p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Recording Assurance</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        Kamera yang mulai stale, missing segment, atau recording process down.
                    </p>
                </div>
            </div>

            <div className="mt-4 overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Camera</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Health</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Reasons</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Latest End Age</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Recent Gap</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cameras.map((camera) => (
                            <tr
                                key={camera.id}
                                className="border-b border-gray-100 dark:border-gray-800 dark:hover:bg-gray-700/40"
                            >
                                <td className="px-4 py-3">
                                    <div className="font-medium text-gray-900 dark:text-white">{camera.name}</div>
                                    <div className="text-xs text-gray-600 dark:text-gray-300">ID {camera.id}</div>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`rounded px-2 py-1 text-xs font-medium capitalize ${getHealthTone(camera.health)}`}>
                                        {camera.health}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex flex-wrap gap-2">
                                        {(camera.reasons?.length ? camera.reasons : ['healthy']).map((reason) => (
                                            <span
                                                key={`${camera.id}-${reason}`}
                                                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-700/80 dark:text-gray-100"
                                            >
                                                {formatReason(reason)}
                                            </span>
                                        ))}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                                    {formatSeconds(camera.seconds_since_latest_end)}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                                    {camera.recent_gap
                                        ? `${camera.recent_gap.gap_count} gap, max ${camera.recent_gap.max_gap_seconds}s`
                                        : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
