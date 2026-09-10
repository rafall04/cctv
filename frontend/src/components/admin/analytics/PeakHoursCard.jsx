import { EmptyState } from '../../ui/EmptyState';

export default function PeakHoursCard({ peakHours }) {
    return (
        <div className="bg-surface border border-edge rounded-2xl p-6">
            <h2 className="text-lg font-bold text-content mb-4">Jam Sibuk</h2>
            {peakHours && peakHours.length > 0 ? (
                <div className="space-y-3">
                    {peakHours.map((peak, index) => (
                        <div key={`${peak.hour}-${index}`} className="flex items-center gap-3 p-3 bg-surface-sunken rounded-xl">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${index === 0 ? 'bg-primary text-white' : 'bg-surface-sunken text-content-muted'}`}>
                                {peak.hour}:00
                            </div>
                            <div className="flex-1">
                                <p className="font-semibold text-content">{peak.sessions} sesi</p>
                                <p className="text-xs text-content-muted">{peak.unique_visitors} pengunjung unik</p>
                            </div>
                            {index === 0 && (
                                <span className="px-2 py-1 bg-primary/15 text-primary text-xs font-medium rounded-lg">Puncak</span>
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
