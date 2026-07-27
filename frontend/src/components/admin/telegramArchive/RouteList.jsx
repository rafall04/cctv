/*
 * Purpose: List of configured archive routes with per-route enable/edit/delete actions.
 * Caller: pages/TelegramArchiveSettings.jsx.
 * Deps: React, archiveUi class recipes.
 * MainFuncs: RouteList.
 *
 * Mobile stacks the label above its actions. The previous single-row flex let three buttons win the
 * width and squeezed every label down to "Arsip Se…", which made the list useless on a phone —
 * labels now wrap instead of truncating.
 */

import { btnDanger, btnGhost, card, cardHead, cardTitle, scopeSummary } from './archiveUi';

export function RouteList({ routes, busyId, onToggle, onEdit, onDelete }) {
    return (
        <section className={card}>
            <div className={cardHead}>
                <h2 className={cardTitle}>Rute aktif</h2>
                <span className="font-mono text-xs tabular-nums text-content-subtle">
                    {routes.length}
                </span>
            </div>

            {routes.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-content-muted sm:px-5">
                    Belum ada rute — tidak ada rekaman yang dikirim ke Telegram.
                </p>
            ) : (
                <ul className="divide-y divide-edge">
                    {routes.map((route) => {
                        const off = route.enabled === false;
                        return (
                            <li key={route.id} className="px-4 py-4 sm:px-5">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                                    <div className="flex min-w-0 flex-1 items-start gap-3">
                                        <span
                                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                                off ? 'bg-status-idle' : 'bg-status-live'
                                            }`}
                                            aria-hidden="true"
                                        />
                                        <div className="min-w-0">
                                            <p className="break-words text-sm font-medium text-content">
                                                {route.label || route.id}
                                                {off && (
                                                    <span className="ml-2 rounded-full border border-edge px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide text-content-subtle">
                                                        nonaktif
                                                    </span>
                                                )}
                                            </p>
                                            <p className="mt-1 break-words text-xs text-content-muted">
                                                {scopeSummary(route)}
                                                <span className="mx-1.5 text-content-subtle">→</span>
                                                <span className="font-mono tabular-nums">{route.chatId}</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        <button
                                            type="button"
                                            className={btnGhost}
                                            onClick={() => onToggle(route)}
                                            disabled={busyId === route.id}
                                        >
                                            {off ? 'Aktifkan' : 'Nonaktifkan'}
                                        </button>
                                        <button
                                            type="button"
                                            className={btnGhost}
                                            onClick={() => onEdit(route)}
                                        >
                                            Ubah
                                        </button>
                                        <span className="ml-auto h-6 w-px bg-edge sm:ml-1" aria-hidden="true" />
                                        <button
                                            type="button"
                                            className={btnDanger}
                                            onClick={() => onDelete(route)}
                                            disabled={busyId === route.id}
                                        >
                                            Hapus
                                        </button>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

export default RouteList;
