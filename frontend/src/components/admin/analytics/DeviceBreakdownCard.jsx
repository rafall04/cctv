import { EmptyState } from '../../ui/EmptyState';
import { DeviceIcon } from './AnalyticsPrimitives';

export default function DeviceBreakdownCard({ deviceBreakdown }) {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Perangkat Pengunjung</h2>
            {deviceBreakdown && deviceBreakdown.length > 0 ? (
                <div className="space-y-4">
                    {deviceBreakdown.map((device) => (
                        <div key={device.device_type} className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                                device.device_type === 'mobile' ? 'bg-blue-100 dark:bg-primary/20 text-primary' :
                                device.device_type === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-500' :
                                'bg-gray-100 dark:bg-gray-700 text-gray-500'
                            }`}>
                                <DeviceIcon type={device.device_type} className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="font-semibold text-gray-900 dark:text-white capitalize">{device.device_type || 'Unknown'}</span>
                                    <span className="text-sm text-gray-500 dark:text-gray-400">{device.count} ({device.percentage || 0}%)</span>
                                </div>
                                <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${
                                            device.device_type === 'mobile' ? 'bg-primary' :
                                            device.device_type === 'tablet' ? 'bg-purple-500' :
                                            'bg-gray-500'
                                        }`}
                                        style={{ width: `${device.percentage || 0}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <EmptyState illustration="NoUsers" title="Belum ada data" description="Data perangkat akan muncul setelah ada pengunjung" />
            )}
        </div>
    );
}
