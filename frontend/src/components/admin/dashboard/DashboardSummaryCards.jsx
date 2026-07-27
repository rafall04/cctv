/*
Purpose: Consolidated stat overview and attention notices for the admin dashboard.
Caller: pages/Dashboard.jsx.
Deps: components/ui StatTile/MeterBar/SegmentedBar/Badge.
MainFuncs: DashboardStatsOverview, DashboardAttentionItems.
SideEffects: Opens viewer modal through parent callback.

Three things this file used to get wrong, all fixed here:
  - the live-viewer count wore a purple ping dot. Purple is in no token; the public surface uses
    the cyan `data` accent for exactly this quantity, so the same number had two identities.
  - the CPU meter was a fixed amber->orange gradient, so a box idling at 3% wore the same warning
    colour as one at 95%. Meter colour now comes from the value via loadTone().
  - headline numbers were proportional bold. The dashboard polls every 10 s and a changing digit
    width re-laid-out the tile row; StatTile renders values mono/tabular.
*/

import { StatTile, MeterBar, SegmentedBar, loadTone } from '../../ui/StatTile';

const ATTENTION_TONE = {
    fault: 'border-status-fault/30 bg-status-fault/10 text-status-fault',
    warn: 'border-status-warn/30 bg-status-warn/10 text-status-warn',
    idle: 'border-edge bg-surface-raised text-content-muted',
    data: 'border-data/30 bg-data/10 text-data',
};

export function DashboardAttentionItems({ items }) {
    if (items.length === 0) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {items.map((item) => (
                <div key={item.title} className={`rounded-card border px-4 py-3 ${ATTENTION_TONE[item.tone] ?? ATTENTION_TONE.idle}`}>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs opacity-90">{item.description}</p>
                </div>
            ))}
        </div>
    );
}

const CameraIcon = () => (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const EyeIcon = () => (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
);

const CpuIcon = () => (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
);

const MemoryIcon = () => (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
    </svg>
);

/**
 * Single consolidated dashboard stat row: fleet, live viewers, and the two host meters.
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
            <StatTile
                label="Kamera"
                value={totalCameras}
                icon={<CameraIcon />}
                footnote={`${availability}% online`}
            >
                {/* maintenance is amber, never red: red is reserved for actually broken. */}
                <SegmentedBar
                    segments={[
                        { key: 'online', percent: pct(online), tone: 'live' },
                        { key: 'offline', percent: pct(offline), tone: 'fault' },
                        { key: 'maintenance', percent: pct(maintenance), tone: 'warn' },
                    ]}
                />
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs tabular-nums text-content-muted">
                    <span><span className="font-semibold text-status-live">{online}</span> online</span>
                    <span><span className="font-semibold text-status-fault">{offline}</span> offline</span>
                    {maintenance > 0 && (
                        <span><span className="font-semibold text-status-warn">{maintenance}</span> maintenance</span>
                    )}
                </div>
            </StatTile>

            <StatTile
                label="Viewer Aktif"
                value={stats?.summary?.activeViewers || 0}
                tone="data"
                icon={<EyeIcon />}
                footnote="Klik untuk lihat detail sesi"
                onClick={() => onOpenViewer({ title: 'Semua Viewer Aktif', sessions: stats?.allSessions || [] })}
            />

            <StatTile
                label="CPU"
                value={cpuLoad}
                unit="% load"
                icon={<CpuIcon />}
                footnote={stats?.system?.cpuModel || 'Unknown'}
            >
                <MeterBar percent={cpuLoad} tone={loadTone(cpuLoad)} />
            </StatTile>

            <StatTile
                label="Memori"
                value={memPercent}
                unit="% terpakai"
                icon={<MemoryIcon />}
                footnote={`${formatBytes(memUsed)} / ${formatBytes(stats?.system?.totalMem)}`}
            >
                <MeterBar percent={memPercent} tone={loadTone(memPercent)} />
            </StatTile>
        </div>
    );
}
