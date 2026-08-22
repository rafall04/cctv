/*
 * Purpose: What the archive sidecar has actually sent — totals per status and the most recent
 *          segments, read from the sidecar's own state database.
 * Caller: pages/TelegramArchiveSettings.jsx.
 * Deps: React, archiveUi class recipes.
 * MainFuncs: ArchiveActivity.
 *
 * "no_route" is a deliberate configuration outcome, not a failure, so it stays neutral — only a real
 * failure earns the fault colour.
 */

import { card, cardHead, cardTitle, formatBytes } from './archiveUi';

const STATUS_LABEL = {
    ok: 'terkirim',
    no_route: 'tanpa rute',
    failed: 'gagal',
    missing: 'file hilang',
    too_big: 'terlalu besar',
    dry_run: 'uji coba',
};

// Colour rides a dot, never the 12px label: status-live text on a light surface measures 3.77:1,
// under the 4.5:1 floor. A dot plus neutral text reads in both themes and without colour vision.
function statusDot(status) {
    if (status === 'ok') return 'bg-status-live';
    if (status === 'failed' || status === 'too_big') return 'bg-status-fault';
    return 'bg-status-idle';
}

function StatusTag({ status }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(status)}`} aria-hidden="true" />
            <span className="text-content-muted">{STATUS_LABEL[status] || status}</span>
        </span>
    );
}

export function ArchiveActivity({ activity }) {
    if (!activity?.available) return null;

    return (
        <section className={card}>
            <div className={cardHead}>
                <h2 className={cardTitle}>Aktivitas pengiriman</h2>
            </div>

            <dl className="grid grid-cols-2 gap-px border-b border-edge bg-edge sm:grid-cols-4">
                {activity.totals.map((total) => (
                    <div key={total.status} className="bg-surface-raised px-4 py-3">
                        <dt className="text-[11px] uppercase tracking-wide text-content-subtle">
                            {STATUS_LABEL[total.status] || total.status}
                        </dt>
                        <dd className="mt-1 font-mono text-xl tabular-nums text-content">
                            {total.files}
                        </dd>
                        <dd className="text-xs tabular-nums text-content-muted">
                            {formatBytes(total.bytes)}
                        </dd>
                    </div>
                ))}
            </dl>

            <ul className="divide-y divide-edge">
                {/* The row wraps on purpose: four columns cannot share a 320px line at 1.5x font, and
                    a fixed-width status column pushed the whole admin shell sideways there. */}
                {activity.recent.map((item) => (
                    <li key={item.segmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5">
                        <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-content-muted">
                            cam{item.cameraId}
                        </span>
                        <span
                            className="min-w-0 flex-1 truncate font-mono text-xs text-content-subtle"
                            title={item.filename}
                        >
                            {item.filename}
                        </span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-content-muted">
                            {formatBytes(item.fileSize)}
                        </span>
                        <span className="ml-auto shrink-0 text-xs">
                            <StatusTag status={item.status} />
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default ArchiveActivity;
