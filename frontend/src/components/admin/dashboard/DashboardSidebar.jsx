/*
Purpose: Sidebar widgets for top cameras, recent activity, and dashboard health indicators.
Caller: pages/Dashboard.jsx.
Deps: ../../TopCamerasWidget, ../../ui/EmptyState, ../../ui Card/Badge.
MainFuncs: DashboardSidebar.
SideEffects: None.

Honesty note: the old System Health panel listed three rows but only ONE was measured. "Database:
Optimal" and "API Gateway: Online" were hardcoded strings — they said the same thing whether the
system was healthy or not, which is exactly the decorative-status pattern the token rules ban. The
panel now reports only what it actually knows: the media-server connection, and when the dashboard
last got a good poll.
*/

import { TopCamerasWidget } from '../../TopCamerasWidget';
import { NoActivityEmptyState } from '../../ui/EmptyState';
import { Card, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';

/** Log entries are colour-coded by what the action did, so the timeline scans without reading. */
function logTone(action = '') {
    if (action.includes('DELETE')) return 'bg-status-fault';
    if (action.includes('CREATE')) return 'bg-status-live';
    return 'bg-primary';
}

function ActivityLog({ logs = [] }) {
    return (
        <Card>
            <CardTitle>Aktivitas Terkini</CardTitle>
            <div className="mt-4 space-y-5">
                {logs.length === 0 ? (
                    <NoActivityEmptyState />
                ) : (
                    logs.map((log, idx) => (
                        <div key={log.id} className="relative flex gap-3">
                            {idx !== logs.length - 1 && (
                                <div className="absolute bottom-[-20px] left-[7px] top-5 w-px bg-edge" />
                            )}
                            <div className={`relative z-raised mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-surface ${logTone(log.action)}`} />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-content">{log.details}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="min-w-0 break-all text-xs text-content-muted">{log.username}</span>
                                    <span className="text-xs text-content-subtle" aria-hidden="true">&bull;</span>
                                    <span className="break-words font-mono text-xs tabular-nums text-content-muted">{log.created_at_wib}</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </Card>
    );
}

function HealthRow({ label, tone, state }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-content-muted">{label}</span>
            <Badge tone={tone} dot>{state}</Badge>
        </div>
    );
}

function SystemHealth({ mtxConnected, lastUpdateLabel, refreshFailed }) {
    return (
        <Card>
            <CardTitle as="h3">Status Sistem</CardTitle>
            <div className="mt-4 space-y-3">
                <HealthRow
                    label="Media server"
                    tone={mtxConnected ? 'live' : 'fault'}
                    state={mtxConnected ? 'Terhubung' : 'Terputus'}
                />
                <HealthRow
                    label="Data dashboard"
                    tone={refreshFailed ? 'warn' : 'live'}
                    state={refreshFailed ? 'Tertunda' : 'Terkini'}
                />
            </div>
            <p className="mt-3 border-t border-edge pt-3 text-xs text-content-subtle">
                Pembaruan terakhir <span className="font-mono tabular-nums text-content-muted">{lastUpdateLabel}</span>
            </p>
        </Card>
    );
}

export function DashboardSidebar({ topCameras = [], recentLogs = [], mtxConnected, lastUpdateLabel = '—', refreshFailed = false }) {
    return (
        <div className="space-y-4">
            <TopCamerasWidget cameras={topCameras} />
            <ActivityLog logs={recentLogs} />
            <SystemHealth mtxConnected={mtxConnected} lastUpdateLabel={lastUpdateLabel} refreshFailed={refreshFailed} />
        </div>
    );
}
