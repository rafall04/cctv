import { EmptyState } from '../../ui/EmptyState';
import { CameraFilter, DeviceIcon, Pagination, formatDuration } from './AnalyticsPrimitives';

export default function ViewerAnalyticsSessionsSection({
    topCameras,
    selectedCamera,
    onCameraChange,
    filteredSessions,
    paginatedSessions,
    sessionsPage,
    totalSessionPages,
    onPageChange,
    onExportSessions,
}) {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Sesi Terbaru</h2>
                <div className="flex flex-wrap items-center gap-2">
                    {topCameras && topCameras.length > 0 && (
                        <CameraFilter cameras={topCameras} value={selectedCamera} onChange={onCameraChange} />
                    )}
                    {filteredSessions.length > 0 && (
                        <button
                            onClick={onExportSessions}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-gray-200 dark:border-gray-700"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Export CSV
                        </button>
                    )}
                </div>
            </div>

            {filteredSessions.length > 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Menampilkan {paginatedSessions.length} dari {filteredSessions.length} sesi
                    {selectedCamera && ' (difilter)'}
                </p>
            )}

            {paginatedSessions.length > 0 ? (
                <>
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
                                {paginatedSessions.map((session, index) => (
                                    <tr key={session.id || index} className="text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                        <td className="py-3 pr-4">
                                            <span className="font-semibold text-gray-900 dark:text-white">{session.camera_name}</span>
                                        </td>
                                        <td className="py-3 pr-4">
                                            <span className="font-mono text-gray-600 dark:text-gray-400">{session.ip_address}</span>
                                        </td>
                                        <td className="py-3 pr-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
                                                session.device_type === 'mobile' ? 'bg-blue-100 dark:bg-primary/20 text-primary-600 dark:text-blue-400' :
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
                                                minute: '2-digit',
                                            })}
                                        </td>
                                        <td className="py-3 text-right font-semibold text-gray-900 dark:text-white">{formatDuration(session.duration_seconds)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pagination currentPage={sessionsPage} totalPages={totalSessionPages} onPageChange={onPageChange} />
                </>
            ) : (
                <EmptyState
                    illustration="NoActivity"
                    title="Belum ada sesi"
                    description={selectedCamera ? 'Tidak ada sesi untuk kamera ini' : 'Riwayat sesi akan muncul setelah ada pengunjung yang menonton'}
                />
            )}
        </div>
    );
}
