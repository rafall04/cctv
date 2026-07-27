import { PeriodSelector } from './AnalyticsPrimitives';

export default function ViewerAnalyticsHeader({
    lastUpdate,
    period,
    customDate,
    onPeriodChange,
    onCustomDateChange,
}) {
    return (
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div>
                <p className="text-sm font-semibold text-primary mb-1">Viewer Analytics</p>
                <h1 className="text-2xl font-bold text-content">Statistik Penonton</h1>
                <p className="text-content-muted mt-1">
                    Analisis pengunjung dan aktivitas streaming • Klik bar chart untuk detail
                </p>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                {lastUpdate && (
                    <span className="text-xs text-content-subtle">
                        Update: {lastUpdate.toLocaleTimeString('id-ID')}
                    </span>
                )}
                <PeriodSelector
                    value={period}
                    onChange={onPeriodChange}
                    customDate={customDate}
                    onCustomDateChange={onCustomDateChange}
                />
            </div>
        </div>
    );
}
