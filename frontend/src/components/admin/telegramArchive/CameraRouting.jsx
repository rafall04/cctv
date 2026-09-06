/*
 * Purpose: The resolved answer per camera — which groups each recording camera actually reaches,
 *          including the ones that reach none. Cameras with no route sort to the TOP and are flagged
 *          loudly, so a forgotten archive route cannot hide in a long list. Filterable by area.
 * Caller: pages/TelegramArchiveSettings.jsx.
 * Deps: React, archiveUi class recipes.
 * MainFuncs: CameraRouting.
 *
 * A table on md+ and a card list below it: at 375px a three-column table wrapped every camera name
 * onto three lines and was harder to read than the cards it replaced.
 */

import { useMemo, useState } from 'react';
import { card, cardHead, cardTitle } from './archiveUi';

function Targets({ targets }) {
    if (targets.length === 0) {
        // Loud, not a subtle grey aside: this IS the thing the page exists to catch. An unrouted
        // camera used to read as a faint "tidak dikirim" that was easy to scroll past.
        return (
            <span className="inline-flex items-center gap-1 rounded-full border border-status-warn/40
                bg-status-warn/10 px-2 py-0.5 text-xs font-medium text-status-warn">
                ⚠ belum diarsipkan
            </span>
        );
    }
    return (
        <span className="flex flex-wrap gap-1.5">
            {targets.map((target) => (
                <span
                    key={target.chatId}
                    className="inline-flex items-center gap-1 rounded-full border border-edge
                        bg-surface-sunken px-2 py-0.5 text-xs text-content-muted"
                >
                    {target.label}
                    {target.mode === 'copy' && (
                        <span className="text-[10px] uppercase tracking-wide text-content-subtle">
                            salinan
                        </span>
                    )}
                </span>
            ))}
        </span>
    );
}

export function CameraRouting({ cameras, routedCount }) {
    const [areaFilter, setAreaFilter] = useState('');

    const areaNames = useMemo(
        () => [...new Set(cameras.map((c) => c.areaName).filter(Boolean))].sort(),
        [cameras],
    );

    // Filter by area, then float the unrouted cameras to the top (the ones needing attention), each
    // group kept in the camera's own order otherwise.
    const shown = useMemo(() => {
        const filtered = areaFilter
            ? cameras.filter((c) => c.areaName === areaFilter)
            : cameras;
        return [...filtered].sort((a, b) => (a.targets.length === 0 ? 0 : 1) - (b.targets.length === 0 ? 0 : 1));
    }, [cameras, areaFilter]);

    return (
        <section className={card}>
            <div className={`${cardHead} flex-wrap gap-2`}>
                <h2 className={cardTitle}>Hasil akhir per kamera</h2>
                <div className="flex items-center gap-2">
                    {areaNames.length > 1 && (
                        <select
                            value={areaFilter}
                            onChange={(e) => setAreaFilter(e.target.value)}
                            aria-label="Saring per area"
                            className="rounded-control border border-edge bg-surface-sunken px-2 py-1 text-xs text-content
                                focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                            <option value="">Semua area</option>
                            {areaNames.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                    )}
                    <span className="font-mono text-xs tabular-nums text-content-subtle">
                        {routedCount}/{cameras.length}
                    </span>
                </div>
            </div>

            {/* phone: one card per camera */}
            <ul className="divide-y divide-edge md:hidden">
                {shown.map((camera) => (
                    <li key={camera.id} className="px-4 py-3">
                        <p className="break-words text-sm text-content">{camera.name}</p>
                        <p className="mt-0.5 text-xs text-content-subtle">{camera.areaName || '-'}</p>
                        <div className="mt-2">
                            <Targets targets={camera.targets} />
                        </div>
                    </li>
                ))}
            </ul>

            {/* tablet and up: the same data as a table */}
            <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wide text-content-subtle">
                            <th scope="col" className="px-5 py-2 font-medium">Kamera</th>
                            <th scope="col" className="px-5 py-2 font-medium">Area</th>
                            <th scope="col" className="px-5 py-2 font-medium">Dikirim ke</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                        {shown.map((camera) => (
                            <tr key={camera.id}>
                                <td className="px-5 py-2.5 text-content">{camera.name}</td>
                                <td className="px-5 py-2.5 text-content-muted">{camera.areaName || '-'}</td>
                                <td className="px-5 py-2.5"><Targets targets={camera.targets} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

export default CameraRouting;
