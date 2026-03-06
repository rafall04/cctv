function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function RecordingRestartLogs({ logs }) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/60">
            <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">Auto-Restart Logs</h2>

            {logs.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Camera</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Reason</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Timestamp</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.slice(0, 20).map((log, index) => (
                                <tr key={`${log.camera_name}-${log.restarted_at}-${index}`} className="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40">
                                    <td className="px-4 py-3 text-gray-900 dark:text-white">{log.camera_name}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs ${
                                            log.reason === 'timeout'
                                                ? 'bg-yellow-500/20 text-yellow-400'
                                                : 'bg-red-500/20 text-red-400'
                                        }`}>
                                            {log.reason}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatTimestamp(log.restarted_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="py-8 text-center text-gray-500 dark:text-gray-400">Belum ada restart logs</p>
            )}
        </div>
    );
}
