/*
 * Purpose: The resolved answer per camera — which groups each recording camera actually reaches,
 *          including the ones that reach none. Cameras with no route sort to the TOP and are flagged
 *          loudly, so a forgotten archive route cannot hide in a long list. A filter bar (search +
 *          backup status + area + destination group) mirrors the Camera Management page so a long
 *          fleet is searchable the same way here.
 * Caller: pages/TelegramArchiveSettings.jsx.
 * Deps: React, archiveUi class recipes.
 * MainFuncs: CameraRouting.
 *
 * A table on md+ and a card list below it: at 375px a three-column table wrapped every camera name
 * onto three lines and was harder to read than the cards it replaced.
 */

import { useMemo, useState } from 'react';
import { card, cardHead, cardTitle } from './archiveUi';

const controlCls = 'rounded-control border border-edge bg-surface-sunken px-2 py-1.5 text-xs text-content '
    + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

const STATUS_OPTIONS = [
    { value: 'all', label: 'Semua status' },
    { value: 'unrouted', label: 'Belum diarsipkan' },
    { value: 'routed', label: 'Sudah diarsipkan' },
];

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
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('all');
    const [areaFilter, setAreaFilter] = useState('');
    const [groupFilter, setGroupFilter] = useState('');

    const areaNames = useMemo(
        () => [...new Set(cameras.map((c) => c.areaName).filter(Boolean))].sort(),
        [cameras],
    );

    // Destination groups actually in use, keyed by chatId (labels can repeat) — lets an operator ask
    // "which cameras feed THIS group?", the inverse of the per-camera view.
    const groupOptions = useMemo(() => {
        const seen = new Map();
        for (const c of cameras) {
            for (const t of c.targets) if (!seen.has(t.chatId)) seen.set(t.chatId, t.label || t.chatId);
        }
        return [...seen.entries()]
            .map(([chatId, label]) => ({ chatId, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [cameras]);

    // Filter, then float the unrouted cameras to the top (the ones needing attention), each group
    // kept in the camera's own order otherwise.
    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return cameras
            .filter((c) => {
                if (areaFilter && c.areaName !== areaFilter) return false;
                if (status === 'unrouted' && c.targets.length !== 0) return false;
                if (status === 'routed' && c.targets.length === 0) return false;
                if (groupFilter && !c.targets.some((t) => t.chatId === groupFilter)) return false;
                if (needle) {
                    const hay = `${c.name} ${c.areaName || ''} ${c.targets.map((t) => t.label).join(' ')}`.toLowerCase();
                    if (!hay.includes(needle)) return false;
                }
                return true;
            })
            .sort((a, b) => (a.targets.length === 0 ? 0 : 1) - (b.targets.length === 0 ? 0 : 1));
    }, [cameras, q, status, areaFilter, groupFilter]);

    const filtering = q.trim() || status !== 'all' || areaFilter || groupFilter;

    return (
        <section className={card}>
            <div className={`${cardHead} flex-wrap gap-2`}>
                <h2 className={cardTitle}>Hasil akhir per kamera</h2>
                <span className="font-mono text-xs tabular-nums text-content-subtle">
                    {routedCount}/{cameras.length} diarsipkan
                </span>
            </div>

            {/* Filter bar — same shape as the Camera Management page: search + dropdowns + count. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3">
                <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Cari kamera, area, grup…"
                    aria-label="Cari kamera"
                    className={`${controlCls} min-w-0 flex-1 basis-40`}
                />
                <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Saring status arsip" className={controlCls}>
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {areaNames.length > 1 && (
                    <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} aria-label="Saring per area" className={controlCls}>
                        <option value="">Semua area</option>
                        {areaNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                )}
                {groupOptions.length > 1 && (
                    <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Saring per grup tujuan" className={controlCls}>
                        <option value="">Semua grup</option>
                        {groupOptions.map((g) => <option key={g.chatId} value={g.chatId}>{g.label}</option>)}
                    </select>
                )}
                {filtering && (
                    <span className="ml-auto text-xs text-content-subtle">
                        {shown.length} dari {cameras.length}
                    </span>
                )}
            </div>

            {shown.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-content-subtle">
                    Tidak ada kamera yang cocok dengan filter ini.
                </p>
            ) : (
                <>
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
                </>
            )}
        </section>
    );
}

export default CameraRouting;
