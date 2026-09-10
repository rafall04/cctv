/*
 * Purpose: The resolved answer per recording camera — which groups it reaches, whether that route is
 *          actually DELIVERING (a route can exist yet fail to upload — bot kicked), and the ones that
 *          reach no group at all. A filter bar (search + backup status + area + destination group)
 *          mirrors the Camera Management page, and a Per-kamera/Per-grup toggle lets an operator audit
 *          a single group. Unrouted cameras float to the top and are flagged loudly.
 * Caller: pages/TelegramArchiveSettings.jsx.
 * Deps: React, archiveUi class recipes.
 * MainFuncs: CameraRouting.
 *
 * A table on md+ and a card list below it: at 375px a three-column table wrapped every camera name
 * onto three lines and was harder to read than the cards it replaced.
 */

import { useMemo, useState } from 'react';
import { card, cardHead, cardTitle } from './archiveUi';

const controlCls = 'rounded-control border border-edge bg-surface-sunken px-2 py-1.5 text-base sm:text-xs text-content '
    + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

const STATUS_OPTIONS = [
    { value: 'all', label: 'Semua status' },
    { value: 'unrouted', label: 'Belum diarsipkan' },
    { value: 'failing', label: 'Rute rusak (gagal kirim)' },
    { value: 'routed', label: 'Sudah diarsipkan' },
];

const warnChip = 'inline-flex items-center gap-1 rounded-full border border-status-warn/40 '
    + 'bg-status-warn/10 px-2 py-0.5 text-xs font-medium text-status-warn';

function FailBadge({ detail }) {
    // A route that EXISTS but is not delivering (bot kicked etc.). status-fault red, distinct from the
    // status-warn "belum diarsipkan": here a route was set up and is silently losing footage.
    return (
        <span
            title={detail || undefined}
            className="inline-flex items-center gap-1 rounded-full border border-status-fault/50
                bg-status-fault/10 px-2 py-0.5 text-xs font-medium text-status-fault"
        >
            ⚠ rute rusak
        </span>
    );
}

function Targets({ targets }) {
    if (targets.length === 0) {
        return <span className={warnChip}>⚠ belum diarsipkan</span>;
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
                        <span className="text-[10px] uppercase tracking-wide text-content-subtle">salinan</span>
                    )}
                </span>
            ))}
        </span>
    );
}

export function CameraRouting({ cameras, routedCount, delivery }) {
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('all');
    const [areaFilter, setAreaFilter] = useState('');
    const [groupFilter, setGroupFilter] = useState('');
    const [view, setView] = useState('camera');

    // id -> failure detail, from the backend's upload evidence. Empty when the sidecar state can't be
    // read (evidenceAvailable=false), so we never paint a false "route broken".
    const failMap = useMemo(
        () => new Map((delivery?.failing || []).map((f) => [f.id, f.detail])),
        [delivery],
    );

    const areaNames = useMemo(
        () => [...new Set(cameras.map((c) => c.areaName).filter(Boolean))].sort(),
        [cameras],
    );

    const groupOptions = useMemo(() => {
        const seen = new Map();
        for (const c of cameras) {
            for (const t of c.targets) if (!seen.has(t.chatId)) seen.set(t.chatId, t.label || t.chatId);
        }
        return [...seen.entries()].map(([chatId, label]) => ({ chatId, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [cameras]);

    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return cameras
            .filter((c) => {
                if (areaFilter && c.areaName !== areaFilter) return false;
                if (status === 'unrouted' && c.targets.length !== 0) return false;
                if (status === 'routed' && c.targets.length === 0) return false;
                if (status === 'failing' && !failMap.has(c.id)) return false;
                if (groupFilter && !c.targets.some((t) => t.chatId === groupFilter)) return false;
                if (needle) {
                    const hay = `${c.name} ${c.areaName || ''} ${c.targets.map((t) => t.label).join(' ')}`.toLowerCase();
                    if (!hay.includes(needle)) return false;
                }
                return true;
            })
            .sort((a, b) => (a.targets.length === 0 ? 0 : 1) - (b.targets.length === 0 ? 0 : 1));
    }, [cameras, q, status, areaFilter, groupFilter, failMap]);

    // Group view: invert the FILTERED camera set into "which cameras feed each group", plus a bucket
    // for the unrouted ones so the gap is never hidden by switching views.
    const byGroup = useMemo(() => {
        const map = new Map();
        const unrouted = [];
        for (const c of shown) {
            if (c.targets.length === 0) { unrouted.push(c); continue; }
            for (const t of c.targets) {
                let g = map.get(t.chatId);
                if (!g) { g = { chatId: t.chatId, label: t.label || t.chatId, cameras: [] }; map.set(t.chatId, g); }
                g.cameras.push({ id: c.id, name: c.name, areaName: c.areaName, mode: t.mode });
            }
        }
        return { groups: [...map.values()].sort((a, b) => a.label.localeCompare(b.label)), unrouted };
    }, [shown]);

    const filtering = q.trim() || status !== 'all' || areaFilter || groupFilter;
    const segBtn = (active) => `px-2.5 py-1 text-xs ${active ? 'bg-surface-sunken text-content' : 'text-content-subtle'}`;

    return (
        <section className={card}>
            <div className={`${cardHead} flex-wrap gap-2`}>
                <h2 className={cardTitle}>Hasil akhir per kamera</h2>
                <div className="flex items-center gap-2">
                    <div className="inline-flex overflow-hidden rounded-control border border-edge" role="group" aria-label="Tampilan">
                        <button type="button" className={segBtn(view === 'camera')} onClick={() => setView('camera')}>Per kamera</button>
                        <button type="button" className={segBtn(view === 'group')} onClick={() => setView('group')}>Per grup</button>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-content-subtle">{routedCount}/{cameras.length}</span>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3">
                <input
                    type="search" value={q} onChange={(e) => setQ(e.target.value)}
                    placeholder="Cari kamera, area, grup…" aria-label="Cari kamera"
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
                {filtering && <span className="ml-auto text-xs text-content-subtle">{shown.length} dari {cameras.length}</span>}
            </div>

            {shown.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-content-subtle">Tidak ada kamera yang cocok dengan filter ini.</p>
            ) : view === 'group' ? (
                <div className="divide-y divide-edge">
                    {byGroup.unrouted.length > 0 && (
                        <div className="px-4 py-3">
                            <p className="mb-2 text-xs font-semibold text-status-warn">⚠ Belum diarsipkan ({byGroup.unrouted.length})</p>
                            <ul className="flex flex-wrap gap-1.5">
                                {byGroup.unrouted.map((c) => (
                                    <li key={c.id} className="rounded-full border border-status-warn/40 bg-status-warn/10 px-2 py-0.5 text-xs text-status-warn">{c.name}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {byGroup.groups.map((g) => (
                        <div key={g.chatId} className="px-4 py-3">
                            <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm text-content">
                                <span className="font-medium">{g.label}</span>
                                <span className="font-mono text-xs tabular-nums text-content-subtle">{g.chatId} · {g.cameras.length} kamera</span>
                            </p>
                            <ul className="space-y-1">
                                {g.cameras.map((c) => (
                                    <li key={`${g.chatId}-${c.id}`} className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="text-content">{c.name}</span>
                                        <span className="text-content-subtle">{c.areaName || '-'}</span>
                                        {c.mode === 'copy' && <span className="text-[10px] uppercase tracking-wide text-content-subtle">salinan</span>}
                                        {failMap.has(c.id) && <FailBadge detail={failMap.get(c.id)} />}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            ) : (
                <>
                    <ul className="divide-y divide-edge md:hidden">
                        {shown.map((camera) => (
                            <li key={camera.id} className="px-4 py-3">
                                <p className="break-words text-sm text-content">{camera.name}</p>
                                <p className="mt-0.5 text-xs text-content-subtle">{camera.areaName || '-'}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Targets targets={camera.targets} />
                                    {failMap.has(camera.id) && <FailBadge detail={failMap.get(camera.id)} />}
                                </div>
                            </li>
                        ))}
                    </ul>

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
                                        <td className="px-5 py-2.5">
                                            <span className="flex flex-wrap items-center gap-1.5">
                                                <Targets targets={camera.targets} />
                                                {failMap.has(camera.id) && <FailBadge detail={failMap.get(camera.id)} />}
                                            </span>
                                        </td>
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
