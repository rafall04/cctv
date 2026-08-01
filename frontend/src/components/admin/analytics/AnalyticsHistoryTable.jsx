import { useRef } from 'react';
import { EmptyState } from '../../ui/EmptyState';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { DeviceIcon, Pagination, formatDuration, formatWatchTime } from './AnalyticsPrimitives';

function SummaryPill({ label, value }) {
    return (
        <div className="rounded-control border border-edge bg-surface-sunken px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-content-muted">{label}</div>
            <div className="mt-1 text-sm font-semibold text-content">{value}</div>
        </div>
    );
}

export function AnalyticsHistoryDrawer({ open, session, title, fields, onClose }) {
    const panelRef = useRef(null);
    // Hooks before any conditional return (React #310); the trap idles while closed.
    useFocusTrap(panelRef, { active: open && Boolean(session), onEscape: onClose });

    if (!open || !session) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-modal flex justify-end bg-black/60" onClick={onClose}>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="h-full w-full max-w-lg overflow-y-auto border-l border-edge bg-surface-overlay p-6 shadow-e2"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-bold text-content">{title}</h3>
                        <p className="text-sm text-content-muted">
                            Detail sesi untuk analisis operasional dan audit ringan.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-xl bg-surface-sunken px-3 py-2 text-sm font-medium text-content-muted transition-colors hover:bg-surface-sunken"
                    >
                        Tutup
                    </button>
                </div>

                <div className="space-y-3">
                    {fields.map((field) => (
                        <div key={field.label} className="rounded-2xl border border-edge p-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-content-muted">{field.label}</div>
                            <div className="mt-1 break-all text-sm text-content">
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
    renderCard = null,
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
        <section className="rounded-2xl border border-edge bg-surface p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-content">{title}</h2>
                    {description && <p className="text-sm text-content-muted">{description}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {onExport && (
                        <button
                            onClick={onExport}
                            className="rounded-xl border border-edge px-3 py-2 text-xs font-medium text-content-muted transition-colors hover:bg-surface-sunken"
                        >
                            Export CSV
                        </button>
                    )}
                    <label className="text-sm text-content-muted">
                        <span className="sr-only">Ukuran halaman</span>
                        <select
                            value={pagination.pageSize}
                            onChange={(event) => onPageSizeChange(Number(event.target.value))}
                            className="rounded-xl border border-edge bg-surface px-3 py-2 dark:text-white"
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
                    {/*
                      * Cards on a phone, table from lg up.
                      *
                      * `overflow-x-auto` stopped the page widening — the right instinct — but a
                      * six-column history on a 360px screen still could not be READ: reaching the
                      * IP scrolled the camera name off, so the two halves of one row were never
                      * visible together. A card owns its width, so a row stays a row.
                      */}
                    {renderCard && (
                        <ul className="space-y-2 lg:hidden">
                            {items.map((item, index) => (
                                <li
                                    key={rowKey(item, index)}
                                    onClick={() => onRowClick?.(item)}
                                    className={`rounded-card border border-edge bg-surface p-3 ${onRowClick ? 'cursor-pointer' : ''}`}
                                >
                                    {renderCard(item)}
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className={`overflow-x-auto ${renderCard ? 'hidden lg:block' : ''}`}>
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="text-left text-content-muted">
                                    {columns.map((column) => (
                                        <th key={column.key} className="pb-3 pr-4 font-semibold">{column.label}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-edge">
                                {items.map((item, index) => (
                                    <tr
                                        key={rowKey(item, index)}
                                        className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-surface-sunken' : ''}`}
                                        onClick={() => onRowClick?.(item)}
                                    >
                                        {columns.map((column) => (
                                            <td key={column.key} className="py-3 pr-4 align-top text-content-muted">
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
            : 'bg-surface-sunken text-content-muted';

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ${tone}`}>
            <DeviceIcon type={normalizedType} className="h-3 w-3" />
            {normalizedType}
        </span>
    );
}

export function renderDurationText(seconds) {
    return <span className="font-semibold text-content">{formatDuration(seconds || 0)}</span>;
}
