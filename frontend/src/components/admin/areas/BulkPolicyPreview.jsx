/*
 * Purpose: Render the impact preview panel for admin area bulk camera policy operations.
 * Caller: AreaManagement bulk policy modal.
 * Deps: Admin area option label utilities.
 * MainFuncs: BulkPolicyPreview.
 * SideEffects: Emits preview callback only; no API calls.
 */

import { getBulkFilterLabel } from '../../../utils/admin/areaManagementOptions';

function SummaryTile({ label, value, valueClassName = 'text-gray-900 dark:text-white' }) {
    return (
        <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
            <div className="text-gray-500 dark:text-gray-400 text-xs">{label}</div>
            <div className={`font-semibold ${valueClassName}`}>{value || 0}</div>
        </div>
    );
}

function BreakdownList({ title, items, badgeClassName }) {
    return (
        <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-3 border border-gray-200 dark:border-gray-700">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">{title}</div>
            <div className="space-y-2">
                {items.slice(0, 5).map((item) => (
                    <div key={item.key || item.reason} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-gray-700 dark:text-gray-300">{item.key || item.reason}</span>
                        <span className={`px-2 py-1 rounded-full shrink-0 ${badgeClassName}`}>{item.count}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function CameraExampleList({ title, cameras, showReason = false }) {
    return (
        <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-3 border border-gray-200 dark:border-gray-700">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">{title}</div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
                {cameras.map((camera) => (
                    <div key={camera.id} className="flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                            <div className="text-gray-900 dark:text-white truncate">{camera.name}</div>
                            {showReason && <div className="text-gray-500 dark:text-gray-400 truncate">{camera.reason}</div>}
                        </div>
                        <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 shrink-0">
                            {camera.delivery_classification}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function BulkPolicyPreview({
    bulkPreview,
    bulkPreviewLoading,
    effectiveBulkTargetFilter,
    onPreview,
}) {
    const summary = bulkPreview?.summary || {};

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Preview Dampak</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Lihat target kamera dan breakdown sebelum apply.</p>
                    </div>
                    <button
                        type="button"
                        onClick={onPreview}
                        className="px-3 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50"
                        disabled={bulkPreviewLoading}
                    >
                        {bulkPreviewLoading ? 'Memuat...' : 'Preview'}
                    </button>
                </div>

                {bulkPreview ? (
                    <div className="space-y-3 text-sm">
                        <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-3 border border-gray-200 dark:border-gray-700">
                            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Target Aktif</div>
                            <div className="font-semibold text-gray-900 dark:text-white">{getBulkFilterLabel(bulkPreview.targetFilter || effectiveBulkTargetFilter)}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <SummaryTile label="Total Area" value={summary.totalInArea} />
                            <SummaryTile label="Matched Filter" value={summary.matchedCount} />
                            <SummaryTile label="Eligible" value={summary.eligibleCount} valueClassName="text-emerald-600 dark:text-emerald-300" />
                            <SummaryTile label="Blocked" value={summary.blockedCount} valueClassName="text-red-600 dark:text-red-300" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <SummaryTile label="Unresolved" value={summary.unresolvedCount} valueClassName="text-amber-600 dark:text-amber-300" />
                            <SummaryTile label="Recording Enabled" value={summary.recordingEnabledCount} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <BreakdownList
                                title="Delivery Mix"
                                items={summary.deliveryTypeBreakdown || []}
                                badgeClassName="bg-sky-100 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300"
                            />
                            <BreakdownList
                                title="Current Health Modes"
                                items={summary.externalHealthModeBreakdown || []}
                                badgeClassName="bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            />
                        </div>
                        {(summary.blockedReasons || []).length > 0 && (
                            <BreakdownList
                                title="Blocked Reasons"
                                items={summary.blockedReasons || []}
                                badgeClassName="bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300"
                            />
                        )}
                        <CameraExampleList title="Contoh Kamera Terdampak" cameras={summary.examples || []} />
                        {(summary.blockedExamples || []).length > 0 && (
                            <CameraExampleList title="Contoh Kamera Tidak Eligible" cameras={summary.blockedExamples || []} showReason />
                        )}
                        {bulkPreview.guidance && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 px-3 py-3 text-amber-800 dark:text-amber-300">
                                {bulkPreview.guidance}
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Belum ada preview. Klik Preview untuk melihat dampak target filter dan operasi.</p>
                )}
            </div>
        </div>
    );
}
