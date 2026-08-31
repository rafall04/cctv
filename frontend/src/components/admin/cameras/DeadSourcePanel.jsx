/*
 * Purpose: Name the cameras that are not coming back on their own, so an operator chases the
 *          provider instead of re-checking a feed that no longer exists.
 * Caller: pages/CameraManagement.jsx.
 * Deps: cameraService.getSourceHealth, components/ui primitives.
 * MainFuncs: DeadSourcePanel.
 * SideEffects: One GET /api/admin/cameras/source-health on mount.
 *
 * SILENT WHEN THERE IS NOTHING TO SAY
 * The panel renders nothing at all while every source is alive. A permanent "0 kamera bermasalah"
 * box would take space at the top of the busiest admin page to say nothing, and would train people
 * to skip the region where the warning eventually appears.
 *
 * `warn`, not `fault`. Nothing in THIS system is broken — a third party took their stream down.
 * Colouring it red would put it in the same visual bucket as an outage the operator caused and
 * could fix, which is the confusion the whole panel exists to remove. (docs/frontend-guide.md)
 */

import { useEffect, useState } from 'react';
import { Badge, Card, CardHeader } from '../../ui';
import { cameraService } from '../../../services/cameraService';
import { useTimezone } from '../../../contexts/TimezoneContext';

/** ISO in, local phrasing out. "sejak 31 Agu 10.29" reads faster than a raw timestamp. */
function sinceText(iso, timeZone) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    return at.toLocaleString('id-ID', {
        timeZone,
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
}

const durationText = (hours) => (hours >= 48 ? `${Math.floor(hours / 24)} hari` : `${hours} jam`);

export default function DeadSourcePanel() {
    const [data, setData] = useState(null);
    const { timezone } = useTimezone();

    useEffect(() => {
        let alive = true;
        cameraService.getSourceHealth().then((res) => {
            if (alive && res?.success) setData(res.data);
        });
        return () => { alive = false; };
    }, []);

    if (!data?.total) return null;

    return (
        <Card>
            <CardHeader
                title={(
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-content">
                            {data.total} kamera mati di sumber
                        </span>
                        {data.stillPublic > 0 && (
                            <Badge tone="warn">{data.stillPublic} masih tayang</Badge>
                        )}
                    </span>
                )}
                description={`Bukan gangguan sementara: sumbernya sudah tidak mengirim stream selama lebih dari ${data.confirmAfterHours} jam berturut-turut. Hanya penyedia streamnya yang bisa memperbaiki ini.`}
            />

            <ul className="mt-3 divide-y divide-edge">
                {data.cameras.map((camera) => (
                    <li key={camera.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
                        <span className="text-sm font-medium text-content">{camera.name}</span>
                        {camera.areaName && (
                            <span className="text-xs text-content-subtle">{camera.areaName}</span>
                        )}
                        <span className="text-xs tabular-nums text-content-muted">
                            sejak {sinceText(camera.since, timezone)} · {durationText(camera.hours)}
                        </span>
                        {/*
                          * "Masih tayang" is the actionable half. A dead camera the operator already
                          * disabled needs nothing; one still enabled is an empty card on the public
                          * page right now.
                          */}
                        {camera.enabled
                            ? <Badge tone="warn" dot>Masih tayang</Badge>
                            : <Badge tone="idle" dot>Sudah dimatikan</Badge>}
                        <span className="w-full text-xs leading-5 text-content-muted">
                            {camera.explanation}
                        </span>
                    </li>
                ))}
            </ul>

            <p className="mt-3 text-xs leading-5 text-content-subtle">
                Matikan kamera lewat tombol di kartunya agar tidak menjadi kartu kosong di halaman
                publik. Kalau penyedia sudah memperbaikinya, kamera hilang sendiri dari daftar ini
                pada pemeriksaan kesehatan berikutnya.
            </p>
        </Card>
    );
}
