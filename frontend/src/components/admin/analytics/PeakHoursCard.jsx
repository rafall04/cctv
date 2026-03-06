import { EmptyState } from '../../ui/EmptyState';

export default function PeakHoursCard({ peakHours }) {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Jam Sibuk</h2>
            {peakHours && peakHours.length > 0 ? (
                <div className="space-y-3">
                    {peakHours.map((peak, index) => (
                        <div key={`${peak.hour}-${index}`} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${index === 0 ? 'bg-gradient-to-br from-primary-400 to-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                {peak.hour}:00
                            </div>
                            <div className="flex-1">
                                <p className="font-semibold text-gray-900 dark:text-white">{peak.sessions} sesi</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{peak.unique_visitors} pengunjung unik</p>
                            </div>
                            {index === 0 && (
                                <span className="px-2 py-1 bg-sky-100 dark:bg-primary/20 text-primary-600 dark:text-primary-400 text-xs font-medium rounded-lg">Peak</span>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <EmptyState illustration="NoActivity" title="Belum ada data" description="Data jam sibuk akan muncul setelah ada aktivitas" />
            )}
        </div>
    );
}
