import { EmptyState } from '../../ui/EmptyState';
import { ActivityHeatmap } from '../../ActivityHeatmap';
import { InteractiveBarChart, SimpleBarChart } from './AnalyticsPrimitives';

export default function ViewerAnalyticsChartsSection({
    charts,
    sessionsByDayData,
    hourlyData,
    selectedDate,
    onBarClick,
    onHeatmapCellClick,
}) {
    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Sesi per Hari</h2>
                        <span className="text-xs text-gray-400 dark:text-gray-500">Klik untuk detail</span>
                    </div>
                    {sessionsByDayData.length > 0 ? (
                        <InteractiveBarChart
                            data={sessionsByDayData}
                            onBarClick={onBarClick}
                            selectedDate={selectedDate}
                        />
                    ) : (
                        <EmptyState illustration="NoActivity" title="Belum ada data" description="Data sesi akan muncul setelah ada pengunjung" />
                    )}
                </div>

                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Aktivitas per Jam</h2>
                    {hourlyData.length > 0 ? (
                        <SimpleBarChart data={hourlyData} />
                    ) : (
                        <EmptyState illustration="NoActivity" title="Belum ada data" description="Data aktivitas akan muncul setelah ada pengunjung" />
                    )}
                </div>
            </div>

            {charts?.activityHeatmap && charts.activityHeatmap.length > 0 && (
                <ActivityHeatmap data={charts.activityHeatmap} onCellClick={onHeatmapCellClick} />
            )}
        </>
    );
}
