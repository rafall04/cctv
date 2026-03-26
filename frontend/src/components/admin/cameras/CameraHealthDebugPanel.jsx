function formatReason(reason) {
    if (!reason) {
        return 'Belum ada data';
    }

    return reason.replace(/_/g, ' ');
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

export default function CameraHealthDebugPanel({ items, loading = false, error = null }) {
    if (loading) {
        return (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/50 dark:text-gray-400">
                Loading health diagnostics...
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-700 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Health diagnostics unavailable: {error}
            </div>
        );
    }

    if (!items?.length) {
        return null;
    }

    const externalItems = items.filter((item) => item.delivery_type !== 'internal_hls');
    const offlineExternalCount = externalItems.filter((item) => item.effectiveOnline !== true).length;

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/50">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <p className="text-sm font-semibold text-primary">Health Debug</p>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Camera health diagnostics</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        External cameras: {externalItems.length} total, {offlineExternalCount} currently offline.
                    </p>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                    Source of truth: backend health pipeline
                </p>
            </div>

            <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700/60 dark:text-gray-400">
                            <th className="px-3 py-2">Camera</th>
                            <th className="px-3 py-2">Delivery</th>
                            <th className="px-3 py-2">Strategy</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Reason</th>
                            <th className="px-3 py-2">Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.cameraId} className="border-b border-gray-100 text-gray-700 dark:border-gray-700/40 dark:text-gray-200">
                                <td className="px-3 py-3">
                                    <div className="font-medium">{item.cameraName}</div>
                                    <div className="text-xs text-gray-400 dark:text-gray-500">ID {item.cameraId}</div>
                                </td>
                                <td className="px-3 py-3 text-xs">{item.delivery_type}</td>
                                <td className="px-3 py-3 text-xs">{item.healthStrategy}</td>
                                <td className="px-3 py-3">
                                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                                        item.effectiveOnline
                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                                            : 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                                    }`}>
                                        {item.effectiveOnline ? 'Online' : 'Offline'}
                                    </span>
                                </td>
                                <td className="px-3 py-3 text-xs">
                                    <div>{formatReason(item.lastReason)}</div>
                                    <div className="mt-1 space-y-1 text-[11px] text-gray-400 dark:text-gray-500">
                                        {renderTarget('Runtime', item.runtimeTarget)}
                                        {renderTarget('Probe', item.probeTarget)}
                                        {renderTarget('Fallback', item.fallbackTarget)}
                                        {item.probeMethod ? (
                                            <div>
                                                <span className="font-medium text-gray-500 dark:text-gray-400">Method:</span>{' '}
                                                {item.probeMethod}
                                            </div>
                                        ) : null}
                                        {item.httpStatus !== null && item.httpStatus !== undefined ? (
                                            <div>
                                                <span className="font-medium text-gray-500 dark:text-gray-400">HTTP:</span>{' '}
                                                {item.httpStatus}
                                            </div>
                                        ) : null}
                                        {item.contentType ? (
                                            <div>
                                                <span className="font-medium text-gray-500 dark:text-gray-400">Type:</span>{' '}
                                                {item.contentType}
                                            </div>
                                        ) : null}
                                        {item.usedFallback ? (
                                            <div>
                                                <span className="font-medium text-gray-500 dark:text-gray-400">Fallback:</span>{' '}
                                                yes
                                            </div>
                                        ) : null}
                                    </div>
                                    {item.lastDetails ? (
                                        <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                                            {JSON.stringify(item.lastDetails)}
                                        </div>
                                    ) : null}
                                </td>
                                <td className="px-3 py-3 text-xs">
                                    {Number(item.failureScore || 0).toFixed(1)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
