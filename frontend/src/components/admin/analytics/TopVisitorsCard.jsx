import { EmptyState } from '../../ui/EmptyState';
import { formatWatchTime } from './AnalyticsPrimitives';

export default function TopVisitorsCard({ topVisitors, onExport }) {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Pengunjung Teratas</h2>
                {topVisitors && topVisitors.length > 0 && (
                    <button
                        onClick={onExport}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Export CSV
                    </button>
                )}
            </div>
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
                            {topVisitors.slice(0, 10).map((visitor, index) => (
                                <tr key={`${visitor.ip_address}-${index}`} className="text-sm">
                                    <td className="py-3">
                                        <span className="font-mono font-semibold text-gray-900 dark:text-white">{visitor.ip_address}</span>
                                    </td>
                                    <td className="py-3 text-center text-gray-600 dark:text-gray-400">{visitor.total_sessions}</td>
                                    <td className="py-3 text-center text-gray-600 dark:text-gray-400">{visitor.cameras_watched}</td>
                                    <td className="py-3 text-right font-semibold text-gray-900 dark:text-white">{formatWatchTime(visitor.total_watch_time)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <EmptyState illustration="NoUsers" title="Belum ada data" description="Data pengunjung akan muncul setelah ada aktivitas" />
            )}
        </div>
    );
}
