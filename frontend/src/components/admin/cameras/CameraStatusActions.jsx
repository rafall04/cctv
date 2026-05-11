/*
Purpose: Render per-camera operational status toggles and manual stream recovery action.
Caller: CameraCard inside Camera Management.
Deps: lucide-react RefreshCw icon.
MainFuncs: CameraStatusActions.
SideEffects: Emits toggle and manual refresh callbacks only.
*/

import { RefreshCw } from 'lucide-react';

export default function CameraStatusActions({
    camera,
    togglingId,
    togglingMaintenanceId,
    refreshingStreamId,
    onToggleEnabled,
    onToggleMaintenance,
    onRefreshStream,
}) {
    const isRefreshingStream = refreshingStreamId === camera.id;

    return (
        <>
            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700/50">
                <span className="text-xs text-gray-400 dark:text-gray-500">ID: {camera.id}</span>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">{camera.enabled ? 'On' : 'Off'}</span>
                    <button
                        onClick={() => onToggleEnabled(camera)}
                        disabled={togglingId === camera.id}
                        className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${camera.enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${camera.enabled ? 'left-5' : 'left-0.5'}`}></div>
                    </button>
                </div>
            </div>

            <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-200 dark:border-gray-700/50">
                <span className="text-xs text-gray-500 dark:text-gray-400">Stream source</span>
                <button
                    type="button"
                    onClick={() => onRefreshStream(camera.id)}
                    disabled={isRefreshingStream}
                    className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950"
                    title="Refresh stream source tanpa disable/enable"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingStream ? 'animate-spin' : ''}`} />
                    {isRefreshingStream ? 'Refreshing...' : 'Refresh Stream'}
                </button>
            </div>

            <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-200 dark:border-gray-700/50">
                <div className="flex items-center gap-1.5">
                    <svg className={`w-3.5 h-3.5 ${camera.status === 'maintenance' ? 'text-red-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63" />
                    </svg>
                    <span className={`text-xs ${camera.status === 'maintenance' ? 'text-red-500 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
                        {camera.status === 'maintenance' ? 'Perbaikan' : 'Normal'}
                    </span>
                </div>
                <button
                    onClick={() => onToggleMaintenance(camera)}
                    disabled={togglingMaintenanceId === camera.id}
                    className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${camera.status === 'maintenance' ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    title={camera.status === 'maintenance' ? 'Matikan mode perbaikan' : 'Aktifkan mode perbaikan'}
                >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${camera.status === 'maintenance' ? 'left-5' : 'left-0.5'}`}></div>
                </button>
            </div>
        </>
    );
}
