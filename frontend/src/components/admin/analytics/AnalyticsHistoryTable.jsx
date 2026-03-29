import { EmptyState } from '../../ui/EmptyState';
import { DeviceIcon, Pagination, formatDuration, formatWatchTime } from './AnalyticsPrimitives';

function SummaryPill({ label, value }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/60">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
            <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
        </div>
    );
}

export function AnalyticsHistoryDrawer({ open, session, title, fields, onClose }) {
    if (!open || !session) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div
                className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl dark:bg-gray-900"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Detail sesi untuk analisis operasional dan audit ringan.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        Tutup
                    </button>
                </div>

                <div className="space-y-3">
                    {fields.map((field) => (
                        <div key={field.label} className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{field.label}</div>
                            <div className="mt-1 break-all text-sm text-gray-900 dark:text-white">
                                {field.render ? field.render(session) : (session[field.key] ?? '-')}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function AnalyticsHistoryTable({
    title,
    description,
    filters,
    summary,
    items,
    columns,
    rowKey,
    renderCell,
    pagination,
    onPageChange,
    onPageSizeChange,
    onRowClick,
    onExport,
    emptyTitle,
    emptyDescription,
}) {
    return (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
                    {description && <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {onExport && (
                        <button
                            onClick={onExport}
                            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                            Export CSV
                        </button>
                    )}
                    <label className="text-sm text-gray-600 dark:text-gray-300">
                        <span className="sr-only">Ukuran halaman</span>
                        <select
                            value={pagination.pageSize}
                            onChange={(event) => onPageSizeChange(Number(event.target.value))}
                            className="rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                        >
                            {[10, 25, 50, 100].map((size) => (
                                <option key={size} value={size}>{size} / halaman</option>
                            ))}
                        </select>
                    </label>
                </div>
            </div>

            <div className="mb-4 space-y-4">
                {filters}
                {summary && (
                    <div className="grid gap-3 md:grid-cols-3">
                        <SummaryPill label="Hasil Filter" value={summary.totalItems || 0} />
                        <SummaryPill label="Unique Viewer" value={summary.uniqueViewers || 0} />
                        <SummaryPill label="Total Watch Time" value={formatWatchTime(summary.totalWatchTime || 0)} />
                    </div>
                )}
            </div>

            {items.length === 0 ? (
                <EmptyState
                    illustration="NoActivity"
                    title={emptyTitle}
                    description={emptyDescription}
                />
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="text-left text-gray-500 dark:text-gray-400">
                                    {columns.map((column) => (
                                        <th key={column.key} className="pb-3 pr-4 font-semibold">{column.label}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {items.map((item, index) => (
                                    <tr
                                        key={rowKey(item, index)}
                                        className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : ''}`}
                                        onClick={() => onRowClick?.(item)}
                                    >
                                        {columns.map((column) => (
                                            <td key={column.key} className="py-3 pr-4 align-top text-gray-600 dark:text-gray-300">
                                                {renderCell(item, column)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pagination
                        currentPage={pagination.page}
                        totalPages={pagination.totalPages}
                        onPageChange={onPageChange}
                    />
                </>
            )}
        </section>
    );
}

export function renderDeviceBadge(type) {
    const normalizedType = type || 'desktop';
    const tone = normalizedType === 'mobile'
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
        : normalizedType === 'tablet'
            ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'
            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ${tone}`}>
            <DeviceIcon type={normalizedType} className="h-3 w-3" />
            {normalizedType}
        </span>
    );
}

export function renderDurationText(seconds) {
    return <span className="font-semibold text-gray-900 dark:text-white">{formatDuration(seconds || 0)}</span>;
}
