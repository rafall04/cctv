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
        <div className="bg-dark-900/90 backdrop-blur-md border border-dark-700/50 rounded-xl p-6">
            <h2 className="text-xl font-bold text-white mb-4">Auto-Restart Logs</h2>

            {logs.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-dark-700">
                                <th className="text-left py-3 px-4 text-dark-300 font-medium">Camera</th>
                                <th className="text-left py-3 px-4 text-dark-300 font-medium">Reason</th>
                                <th className="text-left py-3 px-4 text-dark-300 font-medium">Timestamp</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.slice(0, 20).map((log, index) => (
                                <tr key={`${log.camera_name}-${log.restarted_at}-${index}`} className="border-b border-dark-800 hover:bg-dark-800/50">
                                    <td className="py-3 px-4 text-white">{log.camera_name}</td>
                                    <td className="py-3 px-4">
                                        <span className={`px-2 py-1 rounded text-xs ${
                                            log.reason === 'timeout'
                                                ? 'bg-yellow-500/20 text-yellow-400'
                                                : 'bg-red-500/20 text-red-400'
                                        }`}>
                                            {log.reason}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 text-dark-300">{formatTimestamp(log.restarted_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="text-dark-400 text-center py-8">Belum ada restart logs</p>
            )}
        </div>
    );
}
