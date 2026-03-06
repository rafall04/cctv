import { StatsCard, formatDuration, formatWatchTime } from './AnalyticsPrimitives';

export default function ViewerAnalyticsSummaryGrid({ overview, comparison }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatsCard
                icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                label="Aktif Sekarang"
                value={overview?.activeViewers || 0}
                subValue="viewer sedang menonton"
                color="emerald"
            />
            <StatsCard
                icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
                label="Pengunjung Unik"
                value={overview?.uniqueVisitors || 0}
                subValue={`${overview?.totalSessions || 0} total sesi`}
                color="purple"
                trend={comparison?.trends?.uniqueVisitors}
            />
            <StatsCard
                icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                label="Total Watch Time"
                value={formatWatchTime(overview?.totalWatchTime || 0)}
                subValue={`Rata-rata ${formatDuration(overview?.avgSessionDuration || 0)}/sesi`}
                color="sky"
                trend={comparison?.trends?.totalWatchTime}
            />
            <StatsCard
                icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
                label="Sesi Terlama"
                value={formatDuration(overview?.longestSession || 0)}
                subValue="durasi terlama"
                color="amber"
            />
        </div>
    );
}
