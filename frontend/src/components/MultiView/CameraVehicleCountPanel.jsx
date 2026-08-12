/*
 * Purpose: Show automatic vehicle counts for the showcase camera below its public live video.
 * Caller: VideoPopup public single-camera modal.
 * Deps: vehicleCountService.
 * MainFuncs: CameraVehicleCountPanel.
 * SideEffects: Polls one public read-only endpoint while mounted.
 */

import { useEffect, useRef, useState } from 'react';

import { vehicleCountService } from '../../services/vehicleCountService';

/* Diperbarui tiap 15 detik: penghitung menulis tiap detik, tapi angka publik yang
   berkedip terus justru sulit dibaca — dan endpoint-nya sendiri di-cache 5 detik. */
const REFRESH_MS = 15000;

const JENIS = [
    { key: 'motor', label: 'Motor' },
    { key: 'mobil', label: 'Mobil' },
    { key: 'truk', label: 'Truk' },
    { key: 'bus', label: 'Bus' },
];

function angka(n) {
    return Number(n || 0).toLocaleString('id-ID');
}

/* Strip menit terakhir. Sengaja tanpa sumbu dan tanpa warna: ini konteks bentuk arus,
   bukan grafik yang harus dibaca nilainya satu per satu. */
function StripMenit({ baris }) {
    const puncak = Math.max(1, ...baris.map((b) => b.total));
    return (
        <div className="mt-3">
            <div className="flex h-8 items-end gap-px" aria-hidden="true">
                {baris.map((b) => (
                    <div
                        key={b.menit}
                        className="min-w-0 flex-1 rounded-t-sm bg-content-subtle/70"
                        style={{ height: `${Math.max(6, Math.round((b.total / puncak) * 100))}%` }}
                    />
                ))}
            </div>
            <p className="mt-1 text-xs text-content-subtle">
                {baris[0].menit}–{baris[baris.length - 1].menit} · tertinggi {angka(puncak)} kendaraan/menit
            </p>
        </div>
    );
}

export default function CameraVehicleCountPanel({ cameraId }) {
    const [data, setData] = useState(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!cameraId) {
            setData(null);
            return undefined;
        }
        let cancelled = false;

        const muat = async () => {
            try {
                const hasil = await vehicleCountService.getForCamera(cameraId);
                if (cancelled || !mountedRef.current) return;
                setData(hasil?.data?.tersedia ? hasil.data : null);
            } catch {
                // Kamera tanpa penghitung menjawab 404. Panel ini memang harus diam,
                // bukan memunculkan error di halaman publik.
                if (!cancelled && mountedRef.current) setData(null);
            }
        };

        muat();
        const timer = setInterval(muat, REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [cameraId]);

    if (!data) return null;

    const berhenti = Boolean(data.berhenti);
    const perMenit = Array.isArray(data.perMenit) ? data.perMenit.filter((b) => b.menit) : [];

    return (
        // Blok di DALAM CameraDetailPanel, bukan section berdiri sendiri: induknya sudah
        // memberi padding dan latar, jadi di sini cukup garis pemisah agar tidak dobel.
        <div
            data-testid="camera-vehicle-count-panel"
            className="mt-3 border-t border-edge pt-3"
        >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                    className={`h-2 w-2 shrink-0 rounded-full ${berhenti ? 'bg-status-idle' : 'bg-status-live'}`}
                />
                <span className="sr-only">
                    {berhenti ? 'Penghitungan berhenti diperbarui' : 'Penghitungan sedang berjalan'}
                </span>
                <h3 className="min-w-0 text-sm font-semibold text-content">
                    Hitung kendaraan otomatis
                </h3>
                {/* Label teks hanya muncul saat keadaan tidak normal — supaya yang normal
                    tidak dipenuhi lencana yang tak membawa informasi. */}
                {berhenti && (
                    <span className="text-xs font-medium text-status-idle">
                        Berhenti diperbarui
                    </span>
                )}
            </div>

            {/* Lebar dibatasi: popup ini selebar layar di desktop, dan tanpa pagar ini
                empat kartu jenis kendaraan melar ~300px masing-masing sementara angka arah
                terlempar ke tepi kanan — datanya benar tapi terbaca berantakan. */}
            <div className="mt-2 max-w-2xl">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-2xl font-semibold tabular-nums text-content">
                        {angka(data.total)}
                    </span>
                    <span className="min-w-0 text-xs text-content-muted">
                        kendaraan melintas garis hitung{data.mulaiTeks ? ` sejak ${data.mulaiTeks}` : ''}
                    </span>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {JENIS.map(({ key, label }) => (
                        <div
                            key={key}
                            className="min-w-0 rounded-control border border-edge bg-surface-sunken px-2 py-1.5"
                        >
                            <dt className="truncate text-xs text-content-muted">{label}</dt>
                            <dd className="text-base font-semibold tabular-nums text-content">
                                {angka(data.perJenis?.[key])}
                            </dd>
                        </div>
                    ))}
                </dl>

                {Array.isArray(data.perArah) && data.perArah.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                        {data.perArah.map((arah) => (
                            <li
                                key={arah.label}
                                className="flex min-w-0 items-center justify-between gap-2 text-xs"
                            >
                                <span className="min-w-0 truncate text-content-muted">{arah.label}</span>
                                <span className="shrink-0 tabular-nums font-medium text-content">
                                    {angka(arah.total)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}

                {perMenit.length >= 3 && <StripMenit baris={perMenit} />}

                <p className="mt-3 text-xs text-content-subtle">
                    {berhenti
                        ? 'Angka di atas adalah hasil terakhir sebelum penghitungan berhenti, bukan jumlah saat ini.'
                        : 'Dihitung otomatis dari video langsung kamera ini, satu kali per kendaraan saat melewati garis hitung.'}
                </p>
            </div>
        </div>
    );
}
