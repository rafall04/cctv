import CameraStatusActions from './CameraStatusActions';

function CameraBadge({ condition, className, title, children }) {
    if (!condition) {
        return null;
    }

    return (
        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm ${className}`} title={title}>
            {children}
        </span>
    );
}

export default function CameraCard({
    camera,
    deletingId,
    togglingId,
    togglingMaintenanceId,
    onEdit,
    onDelete,
    onToggleEnabled,
    onToggleMaintenance,
}) {
    const availabilityTone = camera.availability_state === 'online'
        ? 'bg-emerald-500/90 text-white'
        : (camera.availability_state === 'degraded'
            ? 'bg-amber-500/90 text-white'
            : (camera.availability_state === 'maintenance'
                ? 'bg-slate-600/90 text-white'
                : 'bg-red-500/90 text-white'));

    const secondaryBadges = [
        camera.stream_source === 'external' && {
            label: camera.external_health_mode || 'default',
            className: 'bg-sky-600/90 text-white',
            title: 'Health mode kamera external',
        },
        camera.stream_source === 'external' && (camera.external_use_proxy === 1 || camera.external_use_proxy === true) && {
            label: 'Proxy',
            className: 'bg-slate-700/90 text-white',
            title: 'External stream tetap melewati proxy backend',
        },
        camera.stream_source === 'external' && {
            label: camera.external_tls_mode === 'insecure' ? 'TLS Insecure' : 'TLS Strict',
            className: camera.external_tls_mode === 'insecure' ? 'bg-amber-500/90 text-white' : 'bg-emerald-500/90 text-white',
            title: camera.external_tls_mode === 'insecure' ? 'TLS Insecure darurat' : 'TLS Strict default',
        },
        camera.status === 'maintenance' && {
            label: 'Perbaikan',
            className: 'bg-red-500/90 text-white',
            title: 'Dalam Perbaikan',
        },
        camera.is_tunnel === 1 && camera.status !== 'maintenance' && {
            label: 'Tunnel',
            className: 'bg-amber-500/90 text-white',
            title: 'Koneksi Tunnel - Kurang Stabil',
        },
    ].filter(Boolean);

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden hover:shadow-xl hover:border-primary/30 transition-all group">
            <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 relative">
                <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600">
                    <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                </div>
                <div className="absolute top-3 right-3 flex flex-wrap justify-end gap-2 max-w-[85%]">
                    <CameraBadge condition={camera.stream_source === 'internal'} className="bg-emerald-600/90 text-white" title="Stream internal melalui MediaMTX">
                        Internal
                    </CameraBadge>
                    <CameraBadge condition={camera.stream_source === 'external'} className="bg-blue-500/90 text-white" title="Stream Eksternal (Dishub/Pihak Ketiga)">
                        External
                    </CameraBadge>
                    <CameraBadge
                        condition={camera.stream_source === 'internal' && !(camera.enable_recording === 1 || camera.enable_recording === true)}
                        className="bg-slate-700/90 text-white"
                        title="Source internal live-only tanpa recording"
                    >
                        Live Only
                    </CameraBadge>
                    <CameraBadge
                        condition={Boolean(camera.delivery_type)}
                        className="bg-white/90 text-slate-700"
                        title="Delivery type kamera"
                    >
                        {camera.delivery_type || 'unknown'}
                    </CameraBadge>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm ${availabilityTone}`}>
                        {camera.availability_state || (camera.enabled ? 'online' : 'offline')}
                    </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                    <p className="text-[10px] font-semibold text-sky-300 mb-0.5">{camera.area_name || 'Uncategorized'}</p>
                    <h3 className="text-sm font-bold text-white">{camera.name}</h3>
                </div>
            </div>

            <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Location</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{camera.location || 'Not specified'}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                            <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                                Public: {camera.availability_state || 'offline'}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700 dark:bg-gray-700/60 dark:text-gray-200">
                                Monitor: {camera.monitoring_state || 'unknown'}
                            </span>
                            {secondaryBadges.map((badge) => (
                                <span
                                    key={badge.label}
                                    title={badge.title}
                                    className={`rounded-full px-2.5 py-1 font-medium ${badge.className}`}
                                >
                                    {badge.label}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="flex gap-1">
                        <button
                            onClick={() => onEdit(camera)}
                            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-primary hover:bg-sky-50 dark:hover:bg-primary/10 transition-all"
                            title="Edit camera"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                        </button>
                        <button
                            onClick={() => onDelete(camera)}
                            disabled={deletingId === camera.id}
                            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Delete camera"
                        >
                            {deletingId === camera.id ? (
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            )}
                        </button>
                    </div>
                </div>

                <CameraStatusActions
                    camera={camera}
                    togglingId={togglingId}
                    togglingMaintenanceId={togglingMaintenanceId}
                    onToggleEnabled={onToggleEnabled}
                    onToggleMaintenance={onToggleMaintenance}
                />
            </div>
        </div>
    );
}
