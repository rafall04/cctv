import { EmptyState } from '../../ui/EmptyState';
import { formatWatchTime } from './AnalyticsPrimitives';

export default function TopCamerasCard({ topCameras }) {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Kamera Terpopuler</h2>
            {topCameras && topCameras.length > 0 ? (
                <div className="space-y-3">
                    {topCameras.slice(0, 5).map((camera, index) => (
                        <div key={camera.camera_id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm ${
                                index === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-600' :
                                index === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-500' :
                                index === 2 ? 'bg-gradient-to-br from-orange-400 to-orange-600' :
                                'bg-gray-400 dark:bg-gray-600'
                            }`}>
                                {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900 dark:text-white truncate">{camera.camera_name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{camera.total_views} views • {camera.unique_viewers} pengunjung unik</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatWatchTime(camera.total_watch_time)}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">watch time</p>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <EmptyState illustration="NoCamera" title="Belum ada data" description="Data kamera akan muncul setelah ada pengunjung" />
            )}
        </div>
    );
}
