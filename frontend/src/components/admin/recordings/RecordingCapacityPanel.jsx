/*
 * Purpose: Show what each retention setting would actually cost on disk, so the number is chosen
 *          against measured bytes rather than a guess.
 * Caller: pages/RecordingDashboard.jsx.
 * Deps: adminService.getRecordingCapacity (GET /api/admin/recording-capacity), components/ui.
 * MainFuncs: RecordingCapacityPanel.
 * SideEffects: One GET on mount.
 *
 * The operator types the retention they are considering; everything else is arithmetic on the rate
 * the backend measured. No slider — retention is entered in the camera form as a whole number of
 * hours, and a control that produces 37.5 would not match the field it is meant to inform.
 *
 * `warn` for "does not fit", never `fault`: an over-ambitious retention is a plan that needs
 * adjusting, not a system that has broken. (docs/frontend-guide.md)
 */

import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardHeader, Field } from '../../ui';
import { adminService } from '../../../services/adminService';

const GB = 1024 * 1024 * 1024;

const gb = (bytes) => (!Number.isFinite(bytes) ? '—' : `${(bytes / GB).toFixed(1)} GB`);

/** Same grace the backend budgets for: files die at retention + max(10 min, retention × 10%). */
const effectiveHours = (hours) => hours + Math.max(10 / 60, hours * 0.1);

export default function RecordingCapacityPanel() {
    const [data, setData] = useState(null);
    const [hoursInput, setHoursInput] = useState('');

    useEffect(() => {
        let alive = true;
        adminService.getRecordingCapacity().then((res) => {
            if (!alive || !res?.success) return;
            /*
             * Bentuk yang tidak lengkap diperlakukan seperti "belum ada data".
             *
             * Sebelumnya baris berikutnya membaca res.data.retention.currentHours tanpa
             * penjaga, jadi satu respons yang SAH tapi berbentuk lain melempar TypeError,
             * ErrorBoundary menangkapnya, dan SELURUH halaman /admin/recordings berubah jadi
             * layar galat. Satu panel yang kehilangan satu field tidak boleh menjatuhkan
             * halamannya. Tertangkap saat memperluas contrast.spec ke rute admin.
             */
            const d = res.data;
            if (!d?.rate || !d?.disk || !d?.retention) return;
            setData(d);
            setHoursInput(String(d.retention.currentHours ?? 4));
        });
        return () => { alive = false; };
    }, []);

    const custom = useMemo(() => {
        if (!data) return null;
        const hours = Number(hoursInput);
        if (!Number.isFinite(hours) || hours <= 0) return null;

        const bytes = data.rate.bytesPerCameraHour * data.cameras * effectiveHours(hours);
        return {
            hours,
            bytes,
            fits: data.disk.safeBytes === null ? null : bytes <= data.disk.safeBytes,
            spareBytes: data.disk.safeBytes === null ? null : data.disk.safeBytes - bytes,
        };
    }, [data, hoursInput]);

    if (!data) return null;

    return (
        <Card>
            <CardHeader
                title={<span className="text-sm font-semibold text-content">Retensi vs kapasitas disk</span>}
                description={data.rate.source === 'measured'
                    ? `Diukur dari rekaman sendiri: ${(data.rate.bytesPerCameraHour / GB).toFixed(2)} GB per kamera per jam, dari ${data.rate.sampleCameras} kamera / ${data.rate.sampleHours} jam rekaman. ${data.cameras} kamera sedang merekam.`
                    : `Belum cukup data rekaman di sini, jadi memakai angka acuan ${(data.rate.bytesPerCameraHour / GB).toFixed(2)} GB per kamera per jam. ${data.cameras} kamera sedang merekam.`}
            />

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">Dipakai rekaman</dt>
                    <dd className="text-sm font-medium tabular-nums text-content">{gb(data.disk.usedByRecordingsBytes)}</dd>
                </div>
                <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">Sisa disk</dt>
                    <dd className="text-sm font-medium tabular-nums text-content">{gb(data.disk.freeBytes)}</dd>
                </div>
                <div>
                    {/*
                      * Named "cadangan darurat", not "sisa": crossing this threshold makes the
                      * cleanup service start deleting footage in bulk, so it is not room to plan with.
                      */}
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">Cadangan darurat</dt>
                    <dd className="text-sm font-medium tabular-nums text-content">{gb(data.disk.reservedBytes)}</dd>
                </div>
                <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">Bisa dipakai</dt>
                    <dd className="text-sm font-medium tabular-nums text-content">{gb(data.disk.safeBytes)}</dd>
                </div>
            </dl>

            <div className="mt-4 grid gap-3 sm:grid-cols-[12rem,1fr] sm:items-start">
                <Field
                    label="Coba retensi (jam)"
                    type="number"
                    min={1}
                    step={1}
                    value={hoursInput}
                    onChange={(event) => setHoursInput(event.target.value)}
                />
                {custom && (
                    <p className="text-sm leading-6 text-content-muted sm:pt-7">
                        {custom.hours} jam × {data.cameras} kamera ≈ <span className="font-semibold tabular-nums text-content">{gb(custom.bytes)}</span>
                        {' '}(termasuk masa tenggang sampai {effectiveHours(custom.hours).toFixed(1)} jam).{' '}
                        {custom.fits === null
                            ? 'Sisa disk tidak terbaca, jadi kecukupannya belum bisa dipastikan.'
                            : custom.fits
                                ? `Muat, sisa ${gb(custom.spareBytes)}.`
                                : `Kurang ${gb(-custom.spareBytes)} dari yang bisa dipakai.`}
                    </p>
                )}
            </div>

            <ul className="mt-4 divide-y divide-edge border-t border-edge">
                {data.projections.map((projection) => (
                    <li key={projection.hours} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                        <span className="w-20 text-sm tabular-nums text-content">{projection.hours} jam</span>
                        <span className="w-24 text-sm font-medium tabular-nums text-content">{gb(projection.bytes)}</span>
                        {projection.fits === null
                            ? <Badge tone="idle">Belum diketahui</Badge>
                            : projection.fits
                                ? <Badge tone="live" dot>Muat</Badge>
                                : <Badge tone="warn" dot>Tidak muat</Badge>}
                        {projection.isCurrent && <Badge tone="brand">Setelan sekarang</Badge>}
                    </li>
                ))}
            </ul>

            <p className="mt-3 text-xs leading-5 text-content-subtle">
                Mengubah retensi tidak perlu restart — pembersihan membaca ulang nilainya setiap 5
                menit. Angka di atas memakai laju rata-rata; kamera beresolusi tinggi bisa jauh di
                atasnya.
            </p>
        </Card>
    );
}
