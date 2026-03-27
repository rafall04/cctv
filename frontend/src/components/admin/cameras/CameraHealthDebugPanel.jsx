function formatReason(reason) {
    if (!reason) {
        return 'Belum ada data';
    }

    return reason.replace(/_/g, ' ');
}

function formatTimestamp(value) {
    if (!value) {
        return '-';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString('id-ID');
}

function renderTarget(label, value) {
    if (!value) {
        return null;
    }

    return (
        <div>
            <span className="font-medium text-gray-500 dark:text-gray-400">{label}:</span>{' '}
            <span className="break-all">{value}</span>
        </div>
    );
}

function SummaryCard({ label, value, tone = 'default' }) {
    const toneClassName = {
        default: 'border-gray-200 bg-white dark:border-gray-700/60 dark:bg-gray-900/40',
        success: 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10',
        warning: 'border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10',
        danger: 'border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/10',
        info: 'border-sky-200 bg-sky-50 dark:border-sky-500/20 dark:bg-sky-500/10',
    };

    return (
        <div className={`rounded-2xl border p-4 shadow-sm ${toneClassName[tone] || toneClassName.default}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
            <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        </div>
    );
}

function StatusBadge({ label, tone }) {
    const classNameByTone = {
        online: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
        degraded: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200',
        offline: 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300',
        unresolved: 'bg-slate-200 text-slate-700 dark:bg-slate-500/10 dark:text-slate-200',
        maintenance: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    };

    return (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${classNameByTone[tone] || classNameByTone.offline}`}>
            {label}
        </span>
    );
}

export default function CameraHealthDebugPanel({
    summary,
    items,
    pagination,
    query,
    loading = false,
    error = null,
    lastUpdated = null,
    onFilterChange,
    onPageChange,
}) {
    const hasItems = Array.isArray(items) && items.length > 0;

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <SummaryCard label="Total Cameras" value={summary?.total ?? 0} />
                <SummaryCard label="Healthy" value={summary?.healthy ?? 0} tone="success" />
                <SummaryCard label="Degraded" value={summary?.degraded ?? 0} tone="warning" />
                <SummaryCard label="Offline" value={summary?.offline ?? 0} tone="danger" />
                <SummaryCard label="Unresolved" value={summary?.unresolved ?? 0} tone="info" />
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/50">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div className="space-y-1">
                        <p className="text-sm font-semibold text-primary">Backend Health Pipeline</p>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Problem-focused diagnostics</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Internal state, public availability, probe target, runtime evidence, dan domain backoff.
                        </p>
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                        Last updated: {lastUpdated ? formatTimestamp(lastUpdated) : '-'}
                    </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <label className="space-y-1 text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-200">State</span>
                        <select
                            value={query.state}
                            onChange={(event) => onFilterChange('state', event.target.value)}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="problem">Problem only</option>
                            <option value="all">All states</option>
                            <option value="healthy">Healthy</option>
                            <option value="degraded">Degraded</option>
                            <option value="suspect">Suspect</option>
                            <option value="offline">Offline</option>
                            <option value="unresolved">Unresolved</option>
                        </select>
                    </label>

                    <label className="space-y-1 text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-200">Delivery Type</span>
                        <input
                            value={query.deliveryType}
                            onChange={(event) => onFilterChange('deliveryType', event.target.value)}
                            placeholder="external_mjpeg"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </label>

                    <label className="space-y-1 text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-200">Error Class</span>
                        <input
                            value={query.errorClass}
                            onChange={(event) => onFilterChange('errorClass', event.target.value)}
                            placeholder="tls"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </label>

                    <label className="space-y-1 text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-200">Search</span>
                        <input
                            value={query.search}
                            onChange={(event) => onFilterChange('search', event.target.value)}
                            placeholder="camera, area, provider"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </label>

                    <label className="space-y-1 text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-200">Sort</span>
                        <select
                            value={query.sort}
                            onChange={(event) => onFilterChange('sort', event.target.value)}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="severity">Severity</option>
                            <option value="confidence">Confidence</option>
                            <option value="camera">Camera</option>
                        </select>
                    </label>
                </div>

                {loading ? (
                    <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-700/50 dark:bg-gray-900/40 dark:text-gray-400">
                        Loading health diagnostics...
                    </div>
                ) : error ? (
                    <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                        Health diagnostics unavailable: {error}
                    </div>
                ) : !hasItems ? (
                    <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
                        Tidak ada kamera yang cocok dengan filter saat ini.
                    </div>
                ) : (
                    <>
                        <div className="mt-6 overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700/60 dark:text-gray-400">
                                        <th className="px-3 py-2">Camera</th>
                                        <th className="px-3 py-2">Internal State</th>
                                        <th className="px-3 py-2">Public State</th>
                                        <th className="px-3 py-2">Monitoring</th>
                                        <th className="px-3 py-2">Delivery</th>
                                        <th className="px-3 py-2">Reason</th>
                                        <th className="px-3 py-2">Diagnostics</th>
                                        <th className="px-3 py-2">Timing</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item) => (
                                        <tr key={item.cameraId} className="border-b border-gray-100 align-top text-gray-700 dark:border-gray-700/40 dark:text-gray-200">
                                            <td className="px-3 py-3">
                                                <div className="font-medium">{item.cameraName}</div>
                                                <div className="text-xs text-gray-400 dark:text-gray-500">
                                                    ID {item.cameraId}{item.areaName ? ` • ${item.areaName}` : ''}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3">
                                                <div className="space-y-2">
                                                    <StatusBadge label={item.state || 'unknown'} tone={
                                                        item.state === 'healthy'
                                                            ? 'online'
                                                            : item.state === 'degraded' || item.state === 'suspect'
                                                                ? 'degraded'
                                                                : item.state === 'unresolved'
                                                                    ? 'unresolved'
                                                                    : 'offline'
                                                    } />
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        confidence {Number(item.confidence || 0).toFixed(2)}
                                                    </div>
                                                    {item.errorClass ? (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                            {item.errorClass}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3">
                                                <div className="space-y-2">
                                                    <StatusBadge
                                                        label={item.availability_state || (item.effectiveOnline ? 'online' : 'offline')}
                                                        tone={item.availability_state || (item.effectiveOnline ? 'online' : 'offline')}
                                                    />
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        {formatReason(item.availability_reason)}
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        confidence {Number(item.availability_confidence || 0).toFixed(2)}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-xs">
                                                <div className="space-y-2">
                                                    <div className="font-medium text-gray-700 dark:text-gray-200">{item.healthMode || '-'}</div>
                                                    <div className="text-gray-500 dark:text-gray-400">{formatReason(item.monitoring_state)}</div>
                                                    <div className="text-gray-400 dark:text-gray-500">{formatReason(item.monitoring_reason)}</div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-xs">
                                                <div>{item.delivery_type}</div>
                                                <div className="mt-1 text-gray-400 dark:text-gray-500">
                                                    {item.healthStrategy}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-xs">
                                                <div>{formatReason(item.lastReason)}</div>
                                                <div className="mt-1 text-gray-400 dark:text-gray-500">
                                                    failure score {Number(item.failureScore || 0).toFixed(1)}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-xs">
                                                <div className="space-y-1 text-gray-500 dark:text-gray-400">
                                                    {renderTarget('Runtime', item.runtimeTarget)}
                                                    {renderTarget('Probe', item.probeTarget)}
                                                    {renderTarget('Fallback', item.fallbackTarget)}
                                                    {renderTarget('Provider', item.providerDomain)}
                                                    {item.probeMethod ? (
                                                        <div><span className="font-medium text-gray-500 dark:text-gray-400">Method:</span> {item.probeMethod}</div>
                                                    ) : null}
                                                    {item.httpStatus !== null && item.httpStatus !== undefined ? (
                                                        <div><span className="font-medium text-gray-500 dark:text-gray-400">HTTP:</span> {item.httpStatus}</div>
                                                    ) : null}
                                                    {item.contentType ? (
                                                        <div><span className="font-medium text-gray-500 dark:text-gray-400">Type:</span> {item.contentType}</div>
                                                    ) : null}
                                                    {item.usedFallback ? (
                                                        <div><span className="font-medium text-gray-500 dark:text-gray-400">Fallback:</span> yes</div>
                                                    ) : null}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                                                <div>Probe: {formatTimestamp(item.lastProbeAt)}</div>
                                                <div>Runtime ok: {formatTimestamp(item.lastRuntimeSuccessAt)}</div>
                                                <div>Runtime fresh: {formatTimestamp(item.lastRuntimeFreshAt)}</div>
                                                <div>Signal: {item.lastRuntimeSignalType || '-'}</div>
                                                <div>Grace: {formatTimestamp(item.runtimeGraceUntil)}</div>
                                                <div>Backoff: {formatTimestamp(item.domainBackoffUntil)}</div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-5 flex flex-col gap-3 border-t border-gray-200 pt-4 text-sm dark:border-gray-700/60 md:flex-row md:items-center md:justify-between">
                            <div className="text-gray-500 dark:text-gray-400">
                                Menampilkan {items.length} dari {pagination?.totalItems ?? items.length} camera(s)
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => onPageChange(Math.max(1, (pagination?.page || 1) - 1))}
                                    disabled={!pagination?.hasPreviousPage}
                                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200"
                                >
                                    Previous
                                </button>
                                <span className="text-gray-500 dark:text-gray-400">
                                    Page {pagination?.page ?? 1} / {pagination?.totalPages ?? 1}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => onPageChange((pagination?.page || 1) + 1)}
                                    disabled={!pagination?.hasNextPage}
                                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
