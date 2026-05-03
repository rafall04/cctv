/*
 * Purpose: Render one admin area card with metadata, health summaries, grid-default controls, and action links.
 * Caller: AreaManagement area grid.
 * Deps: React Router Link, area coverage utilities, admin area option constants.
 * MainFuncs: AreaCard.
 * SideEffects: Emits callback props for page-owned mutations and modal state.
 */

import { Link } from 'react-router-dom';
import { getAreaCoverageLabel, resolveAreaFocusZoom } from '../../../utils/areaCoverage';
import { GRID_DEFAULT_LIMIT_OPTIONS, INTERNAL_INGEST_POLICY_OPTIONS } from '../../../utils/admin/areaManagementOptions';

function getLocationString(area) {
    const parts = [];
    if (area.rt) parts.push(`RT ${area.rt}`);
    if (area.rw) parts.push(`RW ${area.rw}`);
    if (area.kelurahan) parts.push(area.kelurahan);
    if (area.kecamatan) parts.push(area.kecamatan);
    return parts.join(', ') || 'Belum ada detail lokasi';
}

function isGridDefaultEnabled(area) {
    return area.show_on_grid_default === 1 || area.show_on_grid_default === true;
}

export default function AreaCard({
    area,
    togglingGridAreaId,
    onOpenBulkConfig,
    onBulkDelete,
    onEdit,
    onDelete,
    onToggleGridDefault,
    onGridDefaultLimitChange,
}) {
    const gridDefaultEnabled = isGridDefaultEnabled(area);
    const gridDefaultBusy = togglingGridAreaId === area.id;
    const internalIngestLabel = INTERNAL_INGEST_POLICY_OPTIONS.find(
        (option) => option.value === (area.internal_ingest_policy_default || 'default')
    )?.label || 'Ikuti Default Sistem';

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-[26px] p-5 hover:shadow-xl hover:border-primary/30 transition-all group shadow-sm">
            <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-primary-400 to-primary-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-primary/30 group-hover:scale-110 transition-transform">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                        <circle cx="12" cy="11" r="3" />
                    </svg>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                    <button type="button" title="Pengaturan Massal Kamera" onClick={() => onOpenBulkConfig(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-all">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </button>
                    <Link
                        title="Restore metadata kamera area ini"
                        to={`/admin/backup-restore?areaId=${area.id}`}
                        className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-primary hover:bg-sky-50 dark:hover:bg-primary/10 transition-all"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582M20 11A8 8 0 005.582 9M20 20v-5h-.581M4 13a8 8 0 0014.581 2" />
                        </svg>
                    </Link>
                    <button type="button" title="Hapus Semua Kamera" onClick={() => onBulkDelete(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            <line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} strokeLinecap="round" />
                        </svg>
                    </button>
                    <button type="button" onClick={() => onEdit(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-primary hover:bg-sky-50 dark:hover:bg-primary/10 transition-all">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                    </button>
                    <button type="button" onClick={() => onDelete(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>
            <h3 className="text-[1.7rem] leading-tight font-bold text-gray-900 dark:text-white mb-2">{area.name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 mb-3">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                </svg>
                {getLocationString(area)}
            </p>
            {area.latitude && area.longitude && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-3">Koordinat tersedia</p>
            )}
            <div className="flex flex-wrap gap-2 mb-4">
                {area.kecamatan && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-blue-100 dark:bg-primary/20 text-primary-600 dark:text-blue-400">{area.kecamatan}</span>}
                {area.kelurahan && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">{area.kelurahan}</span>}
                <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-200">
                    {getAreaCoverageLabel(area.coverage_scope)}
                </span>
                {gridDefaultEnabled ? (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300">
                        Grid Default On
                    </span>
                ) : (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300">
                        Grid Default Off
                    </span>
                )}
                {area.externalUnresolvedCount > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">{area.externalUnresolvedCount} unresolved</span>}
                {area.degradedCount > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300">{area.degradedCount} degraded</span>}
                {area.offlineCount > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">{area.offlineCount} offline</span>}
                {area.maintenanceCount > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-200 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200">{area.maintenanceCount} maintenance</span>}
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                <div className="rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-400">Kamera</div>
                    <div className="font-semibold text-gray-900 dark:text-white">{area.cameraCount || 0}</div>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-400">Online</div>
                    <div className="font-semibold text-emerald-700 dark:text-emerald-300">{area.onlineCount || 0}</div>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-400">Offline</div>
                    <div className="font-semibold text-red-700 dark:text-red-300">{area.offlineCount || 0}</div>
                </div>
            </div>
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-gray-50/80 dark:bg-gray-900/40 px-4 py-3 mb-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="text-gray-500 dark:text-gray-400">Health Default Area</div>
                    <div className="text-right font-semibold text-gray-900 dark:text-white">{area.external_health_mode_override || 'default'}</div>
                    <div className="text-gray-500 dark:text-gray-400">Dominant External Mode</div>
                    <div className="text-right font-semibold text-sky-700 dark:text-sky-300">{area.dominantExternalHealthMode || 'default'}</div>
                    <div className="text-gray-500 dark:text-gray-400">Passive Monitored</div>
                    <div className="text-right font-semibold text-emerald-700 dark:text-emerald-300">{area.passiveMonitoredCount || 0}</div>
                    <div className="text-gray-500 dark:text-gray-400">Coverage Area</div>
                    <div className="text-right font-semibold text-gray-900 dark:text-white">{getAreaCoverageLabel(area.coverage_scope)}</div>
                    <div className="text-gray-500 dark:text-gray-400">Focus Zoom</div>
                    <div className="text-right font-semibold text-indigo-700 dark:text-indigo-300">{resolveAreaFocusZoom(area.coverage_scope, area.viewport_zoom_override, 15)}</div>
                    <div className="text-gray-500 dark:text-gray-400">Grid Default</div>
                    <div className="text-right font-semibold text-gray-900 dark:text-white">{gridDefaultEnabled ? 'Enabled' : 'Hidden'}</div>
                    <div className="text-gray-500 dark:text-gray-400">Limit Grid</div>
                    <div className="text-right font-semibold text-gray-900 dark:text-white">{area.grid_default_camera_limit ? `${area.grid_default_camera_limit} kamera` : 'Tanpa batas'}</div>
                    <div className="text-gray-500 dark:text-gray-400">Internal RTSP Policy</div>
                    <div className="text-right font-semibold text-gray-900 dark:text-white">{internalIngestLabel}</div>
                    <div className="text-gray-500 dark:text-gray-400">Idle Close</div>
                    <div className="text-right font-semibold text-gray-900 dark:text-white">{area.internal_on_demand_close_after_seconds ? `${area.internal_on_demand_close_after_seconds} detik` : 'Ikuti default'}</div>
                </div>
            </div>
            <div className="mb-4 grid gap-3">
                <button
                    type="button"
                    onClick={() => onToggleGridDefault(area)}
                    disabled={gridDefaultBusy}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                        gridDefaultEnabled
                            ? 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100 dark:hover:bg-sky-500/20'
                            : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100 dark:border-gray-700/60 dark:bg-gray-900/40 dark:text-gray-100 dark:hover:bg-gray-800/70'
                    } ${gridDefaultBusy ? 'cursor-wait opacity-70' : ''}`}
                >
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="text-sm font-semibold">
                                {gridDefaultBusy
                                    ? 'Menyimpan...'
                                    : (gridDefaultEnabled ? 'Grid Default Aktif' : 'Grid Default Nonaktif')}
                            </div>
                            <div className="mt-1 text-xs opacity-80">
                                Toggle cepat untuk menentukan apakah area ini ikut dimuat saat Grid View masih di semua area.
                            </div>
                        </div>
                        <span className={`inline-flex h-7 w-12 items-center rounded-full px-1 transition-colors ${
                            gridDefaultEnabled ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'
                        }`}>
                            <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                gridDefaultEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`} />
                        </span>
                    </div>
                </button>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700/50 dark:bg-gray-900/40">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">Limit Kamera Grid Default</div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                Berlaku hanya saat Grid View masih di semua area. Saat area dipilih manual, semua kamera area tetap tampil.
                            </div>
                        </div>
                        <select
                            aria-label={`Limit Grid ${area.name}`}
                            value={area.grid_default_camera_limit === null || area.grid_default_camera_limit === undefined ? '' : String(area.grid_default_camera_limit)}
                            onChange={(event) => onGridDefaultLimitChange(area, event.target.value)}
                            disabled={gridDefaultBusy}
                            className="min-w-[140px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                        >
                            {GRID_DEFAULT_LIMIT_OPTIONS.map((option) => (
                                <option key={option.value || 'unlimited'} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700/50">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{area.internalValidCount || 0} Internal &bull; {area.externalValidCount || 0} External</span>
                <div className="flex items-center gap-3">
                    <Link to={`/admin/import-export?area=${encodeURIComponent(area.name)}`} className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
                        Import
                    </Link>
                    <Link to="/admin/cameras" className="text-sm font-semibold text-primary hover:text-primary-600 flex items-center gap-1">
                        Lihat <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </Link>
                </div>
            </div>
        </div>
    );
}
