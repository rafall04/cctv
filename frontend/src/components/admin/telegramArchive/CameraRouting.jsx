/*
 * Purpose: The resolved answer per camera — which groups each recording camera actually reaches,
 *          including the ones that reach none.
 * Caller: pages/TelegramArchiveSettings.jsx.
 * Deps: React, archiveUi class recipes.
 * MainFuncs: CameraRouting.
 *
 * A table on md+ and a card list below it: at 375px a three-column table wrapped every camera name
 * onto three lines and was harder to read than the cards it replaced.
 */

import { card, cardHead, cardTitle } from './archiveUi';

function Targets({ targets }) {
    if (targets.length === 0) {
        return <span className="text-xs text-content-subtle">tidak dikirim</span>;
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
    return (
        <section className={card}>
            <div className={cardHead}>
                <h2 className={cardTitle}>Hasil akhir per kamera</h2>
                <span className="font-mono text-xs tabular-nums text-content-subtle">
                    {routedCount}/{cameras.length}
                </span>
            </div>

            {/* phone: one card per camera */}
            <ul className="divide-y divide-edge md:hidden">
                {cameras.map((camera) => (
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
                        {cameras.map((camera) => (
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
