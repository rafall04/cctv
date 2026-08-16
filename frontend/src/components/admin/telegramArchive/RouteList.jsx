/*
 * Purpose: List of configured archive routes with per-route enable/edit/delete actions.
 * Caller: pages/TelegramArchiveSettings.jsx.
 * Deps: React, archiveUi class recipes.
 * MainFuncs: RouteList.
 *
 * Mobile stacks the label above its actions. The previous single-row flex let three buttons win the
 * width and squeezed every label down to "Arsip Se…", which made the list useless on a phone —
 * labels now wrap instead of truncating.
 *
 * The second line names the actual CAMERA, not just its id. The headline is the route label, which
 * is free text and can say anything: a route sending a private camera to a group named after a
 * different one used to look entirely ordinary here. The facts sit on one wrapping flex row so a
 * narrow screen moves the chat id to its own line instead of truncating or breaking the number.
 */

import { btnDanger, btnGhost, card, cardHead, cardTitle, resolveRouteTarget } from './archiveUi';

export function RouteList({ routes, cameras = [], areas = [], busyId, onToggle, onEdit, onDelete }) {
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
                        const target = resolveRouteTarget(route, { cameras, areas });
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
                                            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-content-muted">
                                                {/* min-w-0: a flex item defaults to min-width:auto and would refuse to
                                                    shrink below its longest word, so break-words alone still overflows
                                                    a 320px screen on a long camera name. */}
                                                <span
                                                    className={`min-w-0 break-words font-medium ${
                                                        target.missing ? 'text-status-fault' : 'text-content'
                                                    }`}
                                                >
                                                    {target.name}
                                                </span>
                                                {target.id && (
                                                    <span className="font-mono tabular-nums text-content-subtle">
                                                        {target.id}
                                                    </span>
                                                )}
                                                {target.detail && (
                                                    <>
                                                        <span className="text-content-subtle" aria-hidden="true">·</span>
                                                        <span className="break-words">{target.detail}</span>
                                                    </>
                                                )}
                                                <span className="text-content-subtle" aria-hidden="true">→</span>
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
