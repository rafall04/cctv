/*
Purpose: Render an admin camera card with stream, monitoring, ingest policy, and status controls.
Caller: CameraGrid inside Camera Management page.
Deps: CameraStatusActions and camera read-model fields.
MainFuncs: CameraCard, CameraBadge, getResolvedIngestPolicy, getIngestBadge.
SideEffects: Emits edit/delete/toggle callbacks only.
*/

import { memo } from 'react';
import CameraStatusActions from './CameraStatusActions';
import CameraThumbnail from '../../CameraThumbnail';

const CAMERA_CLASS_BADGE = {
    subscriber: { label: 'Subscriber', className: 'bg-fuchsia-600/90 text-white', title: 'Kamera sewaan pelanggan' },
    owner_private: { label: 'Owner Private', className: 'bg-purple-600/90 text-white', title: 'Kamera privat operator' },
};

/*
 * Database enum values are not UI labels. `external_hls`, `passive` and `default` were
 * printed raw onto the card, so an operator scanning 36 cameras read column values
 * instead of sentences. These maps are the whole translation layer; anything unmapped
 * falls back to the raw value so a new enum member is still visible rather than blank.
 */
const DELIVERY_LABEL = {
    internal_hls: 'HLS internal',
    external_hls: 'HLS eksternal',
    external_flv: 'FLV',
    external_mjpeg: 'MJPEG',
    external_embed: 'Embed',
    external_jsmpeg: 'JSMpeg',
    external_custom_ws: 'WebSocket',
};

/*
 * The delivery type that a source implies carries no information — an Internal camera on
 * `internal_hls` and an External one on `external_hls` are simply the normal case, and the
 * Internal/External badge right next to it already said so. Only the unusual pairing earns
 * a badge.
 */
const IMPLIED_DELIVERY = { internal: 'internal_hls', external: 'external_hls' };

const MONITORING_LABEL = {
    passive: 'pasif',
    probe_failed: 'probe gagal',
    reconnecting: 'menyambung ulang',
    maintenance: 'perbaikan',
    unresolved: 'belum terpetakan',
    disabled: 'nonaktif',
    stale: 'basi',
    degraded_runtime_recent: 'menurun',
};

const HEALTH_MODE_LABEL = {
    passive_first: 'Health: pasif dulu',
    hybrid_probe: 'Health: hibrida',
    probe_first: 'Health: probe dulu',
    disabled: 'Health: nonaktif',
};

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

function getResolvedIngestPolicy(camera) {
    const cameraOverride = camera.internal_ingest_policy_override;
    const areaDefault = camera.area_internal_ingest_policy_default;
    const strictProfile = camera.source_profile === 'surabaya_private_rtsp';

    if (cameraOverride === 'always_on' || cameraOverride === 'on_demand') {
        return cameraOverride;
    }

    if (areaDefault === 'always_on' || areaDefault === 'on_demand') {
        return areaDefault;
    }

    return strictProfile ? 'on_demand' : 'always_on';
}

function getIngestBadge(camera) {
    const deliveryType = camera.delivery_type || 'internal_hls';
    if (camera.stream_source !== 'internal' && deliveryType !== 'internal_hls') {
        return null;
    }

    const policy = getResolvedIngestPolicy(camera);
    return {
        label: policy === 'always_on' ? 'Ingest: Always On' : 'Ingest: On Demand',
        className: policy === 'always_on'
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
            : 'bg-primary/15 text-primary text-primary',
        title: 'Resolved internal RTSP ingest policy',
    };
}

function CameraCard({
    camera,
    deletingId,
    togglingId,
    togglingMaintenanceId,
    refreshingStreamId,
    onEdit,
    onDelete,
    onToggleEnabled,
    onToggleMaintenance,
    onRefreshStream,
    onChangeClass,
}) {
    const classBadge = CAMERA_CLASS_BADGE[camera.camera_class];
    const availabilityTone = camera.availability_state === 'online'
        ? 'bg-emerald-500/90 text-white'
        : (camera.availability_state === 'degraded'
            ? 'bg-amber-500/90 text-white'
            : (camera.availability_state === 'maintenance'
                ? 'bg-slate-600/90 text-white'
                : 'bg-red-500/90 text-white'));

    const resolvedIngestBadge = getIngestBadge(camera);
    const secondaryBadges = [
        resolvedIngestBadge,
        camera.stream_source === 'internal' && camera.internal_on_demand_close_after_seconds_override && {
            label: `${camera.internal_on_demand_close_after_seconds_override}s`,
            className: 'bg-slate-700/90 text-white',
            title: 'Idle close timeout override',
        },
        camera.stream_source === 'internal' && camera.source_profile && {
            label: camera.source_profile,
            className: 'bg-indigo-600/90 text-white',
            title: 'Source profile internal',
        },
        // `default` means "no override set" — a badge on the absence of a choice is
        // decoration, and it landed on nearly every external camera.
        camera.stream_source === 'external' && HEALTH_MODE_LABEL[camera.external_health_mode] && {
            label: HEALTH_MODE_LABEL[camera.external_health_mode],
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
        camera.monitoring_state === 'reconnecting' && {
            label: 'Reconnecting',
            className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
            title: 'Stream source sedang reconnect setelah update',
        },
    ].filter(Boolean);

    return (
        <div className="bg-surface border border-edge rounded-2xl overflow-hidden hover:shadow-xl hover:border-primary/30 transition-all group">
            <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 relative">
                {/* Was a hardcoded grey camera glyph, so a 36-camera grid was 36 identical
                    tiles — the picture is the fastest way to tell them apart, and it was
                    already being captured and served. CameraThumbnail keeps the offline /
                    maintenance fallbacks so a stale frame never poses as a live one. */}
                <CameraThumbnail
                    thumbnailPath={camera.thumbnail_path}
                    thumbnailVersion={camera.thumbnail_updated_at}
                    cameraName={camera.name}
                    isMaintenance={camera.status === 'maintenance'}
                    isOffline={camera.availability_state === 'offline'}
                />
                <div className="absolute top-3 right-3 flex flex-wrap justify-end gap-2 max-w-[85%]">
                    <CameraBadge condition={Boolean(classBadge)} className={classBadge?.className} title={classBadge?.title}>
                        {classBadge?.label}
                    </CameraBadge>
                    <CameraBadge
                        condition={camera.camera_class === 'subscriber' && camera.billing_status === 'suspended'}
                        className="bg-amber-500/90 text-white"
                        title="Langganan ditangguhkan (saldo/trial habis)"
                    >
                        Suspended
                    </CameraBadge>
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
                        condition={Boolean(camera.delivery_type)
                            && camera.delivery_type !== IMPLIED_DELIVERY[camera.stream_source]}
                        className="bg-white/90 text-slate-700"
                        title="Delivery type kamera"
                    >
                        {DELIVERY_LABEL[camera.delivery_type] || camera.delivery_type}
                    </CameraBadge>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm ${availabilityTone}`}>
                        {camera.availability_state || (camera.enabled ? 'online' : 'offline')}
                    </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                    <p className="text-[10px] font-semibold text-primary mb-0.5">{camera.area_name || 'Tanpa area'}</p>
                    <h3 className="text-sm font-bold text-white">{camera.name}</h3>
                </div>
            </div>

            <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <p className="text-[10px] font-semibold text-content-subtle uppercase tracking-wider">Lokasi</p>
                        <p className="text-sm font-medium text-content">{camera.location || 'Belum diisi'}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                            {/* The `Public: {availability_state}` chip that used to sit here
                                printed the very same field as the big status pill on the
                                thumbnail — the same word, twice, on every card. */}
                            <span className="rounded-full bg-surface-sunken px-2.5 py-1 font-medium text-content">
                                Monitor: {MONITORING_LABEL[camera.monitoring_state] || camera.monitoring_state || 'tidak diketahui'}
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
                        {/* The badge above has always been able to SAY a camera is private; until
                            this button nothing in the product could make one. */}
                        <button
                            onClick={() => onChangeClass(camera)}
                            className="p-2 rounded-lg bg-surface-sunken text-content-muted hover:text-primary hover:bg-primary-100 dark:hover:bg-primary/10 transition-all"
                            title="Ubah kelas kamera (publik / privat)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </button>
                        <button
                            onClick={() => onEdit(camera)}
                            className="p-2 rounded-lg bg-surface-sunken text-content-muted hover:text-primary hover:bg-primary-100 dark:hover:bg-primary/10 transition-all"
                            title="Edit camera"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                        </button>
                        <button
                            onClick={() => onDelete(camera)}
                            disabled={deletingId === camera.id}
                            className="p-2 rounded-lg bg-surface-sunken text-content-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                    refreshingStreamId={refreshingStreamId}
                    onToggleEnabled={onToggleEnabled}
                    onToggleMaintenance={onToggleMaintenance}
                    onRefreshStream={onRefreshStream}
                />
            </div>
        </div>
    );
}

// Memoized: with hundreds of cameras, every filter keystroke re-renders the page.
// Without memo each card re-builds its badge array (~10 spans) on every such render,
// which is the dominant jank. The action callbacks are useCallback-stable in the
// page hook, and the per-card *Id props only change for the one acting card.
export default memo(CameraCard);
