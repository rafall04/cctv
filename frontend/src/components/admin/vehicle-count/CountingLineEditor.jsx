/*
 * Purpose: Draw vehicle-counting lines directly on the camera's own frame, instead of typing coordinates.
 * Caller: pages/VehicleCountSettings.jsx.
 * Deps: React hooks only — the preview image URL is supplied by the caller.
 * MainFuncs: CountingLineEditor.
 * SideEffects: reports edits upward via onChange.
 *
 * Koordinat disimpan sebagai proporsi 0-1 terhadap frame, bukan piksel, jadi garis yang
 * digambar di panel tetap benar walau sumber kamera berganti resolusi dan editor bisa
 * digambar pada ukuran tampilan berapa pun. Pointer event dipakai (bukan mouse) supaya
 * bisa digambar dari HP - admin sering berdiri di lapangan, bukan di depan desktop.
 */

import { useCallback, useRef, useState } from 'react';

const HIT = 0.03;        // sedekat apa sentuhan harus mengenai ujung garis untuk menggesernya
const MIN_PANJANG = 0.05; // ruas lebih pendek dari ini tidak akan pernah dilintasi dengan andal

function jepit01(n) {
    return Math.min(1, Math.max(0, n));
}

function bulat3(n) {
    return Math.round(n * 1000) / 1000;
}

export default function CountingLineEditor({ previewUrl, garis = [], onChange, arahArus }) {
    const [seret, setSeret] = useState(null);
    const kotakRef = useRef(null);

    const keFrame = useCallback((event) => {
        const r = kotakRef.current?.getBoundingClientRect();
        if (!r?.width || !r?.height) return null;
        return {
            x: jepit01((event.clientX - r.left) / r.width),
            y: jepit01((event.clientY - r.top) / r.height),
        };
    }, []);

    /** Ujung garis mana yang tersentuh? Mengembalikan {i, ujung} atau null. */
    const cariUjung = useCallback((p) => {
        for (let i = 0; i < garis.length; i += 1) {
            for (const ujung of ['a', 'b']) {
                const t = garis[i]?.[ujung];
                if (!t) continue;
                if (Math.hypot(t[0] - p.x, t[1] - p.y) <= HIT) return { i, ujung };
            }
        }
        return null;
    }, [garis]);

    const onPointerDown = (event) => {
        const p = keFrame(event);
        if (!p) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);

        const kena = cariUjung(p);
        if (kena) {
            setSeret(kena);                       // geser ujung yang sudah ada
            return;
        }
        if (garis.length >= 6) return;            // sama dengan batas di backend
        // garis baru: mulai sebagai titik, ujung B mengikuti jari sampai dilepas
        onChange([...garis, {
            a: [bulat3(p.x), bulat3(p.y)],
            b: [bulat3(p.x), bulat3(p.y)],
            nama: `Garis ${garis.length + 1}`,
        }]);
        setSeret({ i: garis.length, ujung: 'b' });
    };

    const onPointerMove = (event) => {
        if (!seret) return;
        const p = keFrame(event);
        if (!p) return;
        const berikut = garis.map((g, i) => (
            i === seret.i ? { ...g, [seret.ujung]: [bulat3(p.x), bulat3(p.y)] } : g
        ));
        onChange(berikut);
    };

    const onPointerUp = () => {
        if (!seret) return;
        // Buang ruas yang terlalu pendek: kalau dibiarkan ia tampak seperti garis yang ada
        // padahal tidak akan pernah menghitung apa pun.
        const g = garis[seret.i];
        if (g && Math.hypot(g.a[0] - g.b[0], g.a[1] - g.b[1]) < MIN_PANJANG) {
            onChange(garis.filter((_, i) => i !== seret.i));
        }
        setSeret(null);
    };

    const hapus = (i) => onChange(garis.filter((_, k) => k !== i));

    return (
        <div className="flex flex-col gap-2">
            <div
                ref={kotakRef}
                className="relative w-full touch-none select-none overflow-hidden rounded-card border border-edge bg-surface-sunken"
                style={{ aspectRatio: '16 / 9' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {previewUrl ? (
                    <img
                        src={previewUrl}
                        alt=""
                        draggable={false}
                        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                    />
                ) : (
                    <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-content-muted">
                        Gambar kamera belum tersedia. Garis tetap bisa digambar, tetapi jauh lebih
                        mudah setelah kamera sempat mengambil thumbnail.
                    </div>
                )}

                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    {garis.map((g, i) => (
                        <g key={i}>
                            <line
                                x1={g.a[0]} y1={g.a[1]} x2={g.b[0]} y2={g.b[1]}
                                stroke="#facc15" strokeWidth="0.006" vectorEffect="non-scaling-stroke"
                            />
                            <circle cx={g.a[0]} cy={g.a[1]} r="0.012" fill="#facc15" />
                            <circle cx={g.b[0]} cy={g.b[1]} r="0.012" fill="#facc15" />
                        </g>
                    ))}
                    {arahArus && garis[0] && (
                        <line
                            x1={(garis[0].a[0] + garis[0].b[0]) / 2}
                            y1={(garis[0].a[1] + garis[0].b[1]) / 2}
                            x2={(garis[0].a[0] + garis[0].b[0]) / 2 + arahArus[0] * 0.12}
                            y2={(garis[0].a[1] + garis[0].b[1]) / 2 + arahArus[1] * 0.12}
                            stroke="#4ade80" strokeWidth="0.006" vectorEffect="non-scaling-stroke"
                        />
                    )}
                </svg>
            </div>

            <p className="text-xs text-content-muted">
                Tarik pada gambar untuk membuat garis hitung; tarik ujungnya untuk menggeser.
                Kendaraan dihitung <b>sekali</b> saat melewati garis pertama yang ia lintasi,
                jadi menambah garis memperluas cakupan tanpa membuat hitungan ganda.
            </p>

            {garis.length > 0 && (
                <ul className="flex flex-col gap-1">
                    {garis.map((g, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 text-xs">
                            <span className="min-w-0 truncate text-content-muted">
                                {g.nama || `Garis ${i + 1}`} — ({g.a[0]}, {g.a[1]}) → ({g.b[0]}, {g.b[1]})
                            </span>
                            <button
                                type="button"
                                onClick={() => hapus(i)}
                                className="shrink-0 rounded-control border border-edge px-2 py-1 text-content transition-colors hover:border-edge-strong hover:bg-surface-raised"
                            >
                                Hapus
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
