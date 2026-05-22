/*
Purpose: Consolidated stat overview and attention notices for the admin dashboard.
Caller: pages/Dashboard.jsx.
Deps: None.
MainFuncs: DashboardStatsOverview, DashboardAttentionItems.
SideEffects: Opens viewer modal through parent callback.
*/

export function DashboardAttentionItems({ items }) {
    if (items.length === 0) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {items.map((item) => (
                <div key={item.title} className={`rounded-2xl border px-4 py-3 ${item.tone}`}>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs opacity-90">{item.description}</p>
                </div>
            ))}
        </div>
    );
}

function StatTile({ children, className = '', onClick }) {
    const base = 'rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700/50 dark:bg-gray-800/50';
    if (onClick) {
        return (
            <button type="button" onClick={onClick} className={`${base} text-left transition-all hover:shadow-md ${className}`}>
                {children}
            </button>
        );
    }
    return <div className={`${base} ${className}`}>{children}</div>;
}

function TileHeader({ label, icon }) {
    return (
        <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</span>
            <span className="text-gray-300 dark:text-gray-600">{icon}</span>
        </div>
    );
}

function ProgressBar({ percent, className }) {
    return (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/50">
            <div className={`h-full rounded-full transition-all ${className}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
    );
}

/**
 * Single consolidated dashboard stat row. Replaces the former separate
 * summary cards + camera status overview + quick-stats camera/live tiles —
 * the camera health breakdown is folded inline into the Cameras tile.
 */
export function DashboardStatsOverview({ stats, cpuLoad, memUsed, memPercent, formatBytes, onOpenViewer }) {
    const totalCameras = stats?.summary?.totalCameras || 0;
    const breakdown = stats?.cameraStatusBreakdown || {};
    const online = breakdown.online || 0;
    const offline = breakdown.offline || 0;
    const maintenance = breakdown.maintenance || 0;
    const availability = totalCameras > 0 ? Math.round((online / totalCameras) * 100) : 0;
    const pct = (n) => (totalCameras > 0 ? (n / totalCameras) * 100 : 0);

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Cameras — count + inline status breakdown */}
            <StatTile>
                <TileHeader
                    label="Kamera"
                    icon={(
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    )}
                />
                <div className="flex items-baseline gap-2">
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{totalCameras}</h3>
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{availability}% online</span>
                </div>
                <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/50">
                    <div className="h-full bg-emerald-500" style={{ width: `${pct(online)}%` }} />
                    <div className="h-full bg-red-500" style={{ width: `${pct(offline)}%` }} />
                    <div className="h-full bg-amber-500" style={{ width: `${pct(maintenance)}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <span><span className="font-semibold text-emerald-600 dark:text-emerald-400">{online}</span> online</span>
                    <span><span className="font-semibold text-red-600 dark:text-red-400">{offline}</span> offline</span>
                    {maintenance > 0 && (
                        <span><span className="font-semibold text-amber-600 dark:text-amber-400">{maintenance}</span> maintenance</span>
                    )}
                </div>
            </StatTile>

            {/* Live viewers */}
            <StatTile onClick={() => onOpenViewer({ title: 'Semua Viewer Aktif', sessions: stats?.allSessions || [] })}>
                <TileHeader
                    label="Viewer Aktif"
                    icon={(
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    )}
                />
                <div className="flex items-baseline gap-2">
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{stats?.summary?.activeViewers || 0}</h3>
                    <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500" />
                    </span>
                </div>
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Klik untuk lihat detail sesi</p>
            </StatTile>

            {/* CPU */}
            <StatTile>
                <TileHeader
                    label="CPU"
                    icon={(
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    )}
                />
                <div className="mb-3 flex items-baseline gap-2">
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{cpuLoad}%</h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Load</span>
                </div>
                <ProgressBar percent={cpuLoad} className="bg-gradient-to-r from-amber-400 to-orange-500" />
                <p className="mt-2 truncate text-xs text-gray-500 dark:text-gray-400" title={stats?.system?.cpuModel}>
                    {stats?.system?.cpuModel || 'Unknown'}
                </p>
            </StatTile>

            {/* Memory */}
            <StatTile>
                <TileHeader
                    label="Memory"
                    icon={(
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                        </svg>
                    )}
                />
                <div className="mb-3 flex items-baseline gap-2">
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{memPercent}%</h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Used</span>
                </div>
                <ProgressBar percent={memPercent} className="bg-gradient-to-r from-blue-400 to-primary-600" />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {formatBytes(memUsed)} / {formatBytes(stats?.system?.totalMem)}
                </p>
            </StatTile>
        </div>
    );
}
