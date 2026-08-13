/*
 * Purpose: Draw the detector's monitored area (polygon) and ignored zones (boxes) directly on the
 *          camera's live preview, instead of hand-writing normalised JSON coordinates.
 * Caller: pages/RondaSettings.jsx.
 * Deps: React hooks, rondaAdminService (preview blob).
 * MainFuncs: RondaZoneEditor.
 * SideEffects: fetches the preview frame; reports edits upward via onChange.
 *
 * Coordinates are stored as 0-1 proportions of the frame, so they stay correct at any display size
 * and match exactly what motion.py applies. Pointer events are used (not mouse) so a phone works.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import rondaAdminService from '../../../services/rondaAdminService';

const HIT = 0.025;          // how close a tap must be (in frame proportions) to grab an existing point
const MIN_BOX = 0.02;       // ignore accidental micro-drags

function clamp01(n) {
    return Math.min(1, Math.max(0, n));
}

function round3(n) {
    return Math.round(n * 1000) / 1000;
}

export function RondaZoneEditor({ name, refreshKey, roi, ignore, onChange }) {
    const [mode, setMode] = useState('view');
    const [url, setUrl] = useState(null);
    const [failed, setFailed] = useState(false);
    const [dragBox, setDragBox] = useState(null);
    const urlRef = useRef(null);
    const boxRef = useRef(null);
    const startRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const blob = await rondaAdminService.getPreviewBlob(name);
                if (cancelled) return;
                if (urlRef.current) URL.revokeObjectURL(urlRef.current);
                urlRef.current = URL.createObjectURL(blob);
                setUrl(urlRef.current);
                setFailed(false);
            } catch {
                if (!cancelled) setFailed(true);
            }
        })();
        return () => { cancelled = true; };
    }, [name, refreshKey]);

    useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

    const toFrame = useCallback((event) => {
        const rect = boxRef.current?.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) return null;
        return {
            x: clamp01((event.clientX - rect.left) / rect.width),
            y: clamp01((event.clientY - rect.top) / rect.height),
        };
    }, []);

    const handlePointerDown = (event) => {
        if (mode === 'view') return;
        const p = toFrame(event);
        if (!p) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);

        if (mode === 'roi') {
            // Tapping an existing corner removes it; tapping empty space appends a new one.
            const hitIndex = roi.findIndex(([x, y]) => Math.abs(x - p.x) < HIT && Math.abs(y - p.y) < HIT);
            if (hitIndex >= 0) onChange({ roi: roi.filter((_, i) => i !== hitIndex), ignore });
            else onChange({ roi: [...roi, [round3(p.x), round3(p.y)]], ignore });
            return;
        }

        // Ignore mode: tapping inside a zone deletes it, otherwise start dragging a new one.
        const hitIndex = ignore.findIndex(([x1, y1, x2, y2]) =>
            p.x >= Math.min(x1, x2) && p.x <= Math.max(x1, x2) && p.y >= Math.min(y1, y2) && p.y <= Math.max(y1, y2));
        if (hitIndex >= 0) {
            onChange({ roi, ignore: ignore.filter((_, i) => i !== hitIndex) });
            return;
        }
        startRef.current = p;
        setDragBox([p.x, p.y, p.x, p.y]);
    };

    const handlePointerMove = (event) => {
        if (mode !== 'ignore' || !startRef.current) return;
        const p = toFrame(event);
        if (!p) return;
        setDragBox([startRef.current.x, startRef.current.y, p.x, p.y]);
    };

    const handlePointerUp = () => {
        if (mode !== 'ignore' || !startRef.current || !dragBox) { startRef.current = null; setDragBox(null); return; }
        const [x1, y1, x2, y2] = dragBox;
        startRef.current = null;
        setDragBox(null);
        if (Math.abs(x2 - x1) < MIN_BOX || Math.abs(y2 - y1) < MIN_BOX) return;
        const box = [
            round3(Math.min(x1, x2)), round3(Math.min(y1, y2)),
            round3(Math.max(x1, x2)), round3(Math.max(y1, y2)),
        ];
        onChange({ roi, ignore: [...ignore, box] });
    };

    const polygon = useMemo(
        () => roi.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(' '),
        [roi],
    );

    const helpText = mode === 'roi'
        ? 'Ketuk untuk menambah titik. Ketuk titik yang sudah ada untuk menghapusnya. Minimal 3 titik.'
        : mode === 'ignore'
            ? 'Geser untuk membuat kotak yang diabaikan. Ketuk kotak untuk menghapusnya.'
            : 'Pilih mode di atas untuk mengubah garis langsung di gambar.';

    return (
        <div>
            <div className="mb-2 flex flex-wrap gap-1.5">
                {[
                    { id: 'view', label: 'Lihat' },
                    { id: 'roi', label: 'Area pantau' },
                    { id: 'ignore', label: 'Zona abaikan' },
                ].map((m) => (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => setMode(m.id)}
                        aria-pressed={mode === m.id}
                        /* min-h 40px di layar sempit: ini sakelar mode gambar, kendali paling
                           sering ditekan di halaman ini, dan sebelumnya hanya setinggi 27px. */
                        className={`min-h-[40px] rounded-control border px-3 py-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:min-h-0 sm:px-2.5 ${
                            mode === m.id
                                ? 'border-primary bg-primary/10 text-content'
                                : 'border-edge text-content-muted hover:border-edge-strong'
                        }`}
                    >
                        {m.label}
                    </button>
                ))}
                {mode === 'roi' && roi.length > 0 && (
                    <button type="button" onClick={() => onChange({ roi: [], ignore })}
                        className="min-h-[40px] rounded-control border border-edge px-3 py-1 text-[11px] text-status-fault
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:min-h-0 sm:px-2.5">
                        Bersihkan ({roi.length} titik)
                    </button>
                )}
                {mode === 'ignore' && ignore.length > 0 && (
                    <button type="button" onClick={() => onChange({ roi, ignore: [] })}
                        className="min-h-[40px] rounded-control border border-edge px-3 py-1 text-[11px] text-status-fault
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:min-h-0 sm:px-2.5">
                        Bersihkan ({ignore.length} zona)
                    </button>
                )}
            </div>

            {failed ? (
                <div className="flex h-40 items-center justify-center rounded-control border border-edge bg-surface-sunken text-xs text-content-subtle">
                    Belum ada gambar dari kamera ini
                </div>
            ) : (
                <div
                    ref={boxRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    className={`relative overflow-hidden rounded-control border border-edge ${
                        mode === 'view' ? '' : 'cursor-crosshair touch-none'
                    }`}
                >
                    {url ? (
                        <img src={url} alt={`Tampilan terkini ${name}`} className="block w-full select-none" draggable="false" />
                    ) : (
                        <div className="h-40 animate-pulse bg-surface-sunken" />
                    )}

                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                        {ignore.map(([x1, y1, x2, y2], i) => (
                            <rect
                                key={`ig-${i}`}
                                x={Math.min(x1, x2) * 100} y={Math.min(y1, y2) * 100}
                                width={Math.abs(x2 - x1) * 100} height={Math.abs(y2 - y1) * 100}
                                fill="rgba(220,60,60,0.22)" stroke="rgb(220,60,60)" strokeWidth="0.4"
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        {dragBox && (
                            <rect
                                x={Math.min(dragBox[0], dragBox[2]) * 100} y={Math.min(dragBox[1], dragBox[3]) * 100}
                                width={Math.abs(dragBox[2] - dragBox[0]) * 100} height={Math.abs(dragBox[3] - dragBox[1]) * 100}
                                fill="rgba(220,60,60,0.28)" stroke="rgb(220,60,60)" strokeWidth="0.4" strokeDasharray="2 1"
                                vectorEffect="non-scaling-stroke"
                            />
                        )}
                        {roi.length >= 2 && (
                            <polygon
                                points={polygon}
                                fill={roi.length >= 3 ? 'rgba(250,204,21,0.14)' : 'none'}
                                stroke="rgb(250,204,21)" strokeWidth="0.5" vectorEffect="non-scaling-stroke"
                            />
                        )}
                        {roi.map(([x, y], i) => (
                            <circle key={`pt-${i}`} cx={x * 100} cy={y * 100} r="1.1"
                                fill="rgb(250,204,21)" stroke="rgba(0,0,0,0.6)" strokeWidth="0.3"
                                vectorEffect="non-scaling-stroke" />
                        ))}
                    </svg>
                </div>
            )}

            <p className="mt-1 text-[11px] text-content-subtle">{helpText}</p>
        </div>
    );
}

export default RondaZoneEditor;
