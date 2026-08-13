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

/*
 * Jangkauan sentuh dihitung dalam PIKSEL LAYAR, bukan proporsi bingkai.
 *
 * Sebelumnya 0,03 proporsi: pada gambar selebar 300 px di HP itu berarti 9 px mendatar tetapi
 * hanya 5 px menegak (tingginya 169 px), jadi sasarannya lonjong dan jauh lebih kecil dari
 * ujung jari. 28 px adalah lingkaran yang sama besar ke segala arah, seukuran anjuran sasaran
 * sentuh, dan tetap wajar dengan tetikus di layar lebar.
 */
const HIT_PX = 28;
const MIN_PANJANG = 0.05; // ruas lebih pendek dari ini tidak akan pernah dilintasi dengan andal

function jepit01(n) {
    return Math.min(1, Math.max(0, n));
}

function bulat3(n) {
    return Math.round(n * 1000) / 1000;
}

export default function CountingLineEditor({ previewUrl, garis = [], onChange, arahArus, namaArah = {} }) {
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
        const r = kotakRef.current?.getBoundingClientRect();
        if (!r?.width || !r?.height) return null;
        for (let i = 0; i < garis.length; i += 1) {
            for (const ujung of ['a', 'b']) {
                const t = garis[i]?.[ujung];
                if (!t) continue;
                const dx = (t[0] - p.x) * r.width;      // jarak dinilai di layar, bukan di ruang
                const dy = (t[1] - p.y) * r.height;     // proporsi, supaya bulat ke segala arah
                if (Math.hypot(dx, dy) <= HIT_PX) return { i, ujung };
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

                {/*
                  * strokeWidth di sini dalam PIKSEL LAYAR, bukan satuan viewBox, karena
                  * vectorEffect="non-scaling-stroke". Nilai lama 0.006 berarti garis setebal
                  * 0,006 piksel — tak terlihat sama sekali, sehingga yang tampak hanya titik
                  * ujungnya (r memakai satuan viewBox yang ikut diskalakan). Itulah keluhan
                  * "kok cuma titik kuning".
                  */}
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    <defs>
                        <marker id="panah-arah" viewBox="0 0 10 10" refX="8" refY="5"
                            markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4ade80" />
                        </marker>
                    </defs>

                    {garis.map((g, i) => (
                        <line
                            key={i}
                            x1={g.a[0]} y1={g.a[1]} x2={g.b[0]} y2={g.b[1]}
                            stroke="#facc15" strokeWidth="3" vectorEffect="non-scaling-stroke"
                        />
                    ))}

                    {/* Panah arah A + lawannya, digambar dari tengah garis pertama supaya
                        "mana arah A, mana arah B" terjawab di gambar, bukan hanya di formulir. */}
                    {arahArus && garis[0] && (() => {
                        const cx = (garis[0].a[0] + garis[0].b[0]) / 2;
                        const cy = (garis[0].a[1] + garis[0].b[1]) / 2;
                        const [ux, uy] = arahArus;
                        return (
                            <g>
                                <line
                                    x1={cx} y1={cy} x2={cx + ux * 0.16} y2={cy + uy * 0.16}
                                    stroke="#4ade80" strokeWidth="3" vectorEffect="non-scaling-stroke"
                                    markerEnd="url(#panah-arah)"
                                />
                                <line
                                    x1={cx} y1={cy} x2={cx - ux * 0.10} y2={cy - uy * 0.10}
                                    stroke="#38bdf8" strokeWidth="3" vectorEffect="non-scaling-stroke"
                                    strokeDasharray="4 3"
                                />
                            </g>
                        );
                    })()}
                </svg>

                {/*
                  * Pegangan ujung digambar sebagai elemen HTML, bukan <circle> SVG: viewBox 0-1
                  * diregangkan ke 16:9 dengan preserveAspectRatio="none", jadi lingkaran SVG
                  * keluar sebagai lonjong dan ikut mengecil di layar HP. Ini bulat, ukurannya
                  * tetap dalam piksel, dan sama besar dengan jangkauan sentuh di atas.
                  */}
                {garis.flatMap((g, i) => ['a', 'b'].map((ujung) => (
                    <span
                        key={`${i}-${ujung}`}
                        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2
                                   rounded-full border-2 border-surface bg-[#facc15] shadow-e1"
                        style={{ left: `${g[ujung][0] * 100}%`, top: `${g[ujung][1] * 100}%` }}
                    />
                )))}

                {arahArus && garis[0] && (
                    <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-1 rounded-control bg-surface-overlay/80 px-2 py-1.5 text-xs">
                        <span className="flex items-center gap-1.5 text-content">
                            <span className="inline-block h-0.5 w-4 bg-[#4ade80]" /> {namaArah.plus || 'Arah A'}
                        </span>
                        <span className="flex items-center gap-1.5 text-content">
                            <span className="inline-block h-0.5 w-4 bg-[#38bdf8]" /> {namaArah.minus || 'Arah B'}
                        </span>
                    </div>
                )}
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
                                className="min-h-[40px] shrink-0 rounded-control border border-edge px-3 py-1
                                           text-content transition-colors hover:border-edge-strong
                                           hover:bg-surface-raised sm:min-h-0 sm:px-2"
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
