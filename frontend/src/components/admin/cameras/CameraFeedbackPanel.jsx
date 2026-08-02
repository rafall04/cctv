/*
 * Purpose: The operator's side of visitor feedback — what people reported, and which cameras they
 *          are voting down.
 * Caller: pages/CameraManagement.jsx.
 * Deps: adminService (camera reports + reaction summary), components/ui.
 * MainFuncs: CameraFeedbackPanel.
 * SideEffects: Two GETs on mount; one PUT when a report is closed.
 *
 * This is the ONLY reader of either signal. The public bar prints likes and nothing else, and the
 * report text is never rendered on any public surface — which is exactly what makes accepting free
 * text from anonymous devices safe. Collecting a signal nobody reads would be worse than not
 * collecting it, so both halves land here.
 *
 * Silent when there is nothing open, like DeadSourcePanel: a permanent "0 laporan" box on the
 * busiest admin page teaches people to skip the region where the real warning appears.
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader } from '../../ui';
import { adminService } from '../../../services/adminService';
import { buildPlaybackMomentPath } from '../../../utils/playbackUrlState';

const MAX_COMPLAINED_ROWS = 10;

/* Admin playback, not the public one: staff should land with full reach, not the 10-minute preview. */
const momentPath = (report) => buildPlaybackMomentPath({
    camera: report.cameraId,
    occurredAt: report.occurredAt,
    basePath: '/admin/playback',
});

const when = (value) => {
    const at = new Date(String(value || '').replace(' ', 'T'));
    if (Number.isNaN(at.getTime())) return value || '';
    return at.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function CameraFeedbackPanel() {
    const [reports, setReports] = useState([]);
    const [complained, setComplained] = useState([]);
    const [closingId, setClosingId] = useState(null);

    useEffect(() => {
        let alive = true;
        adminService.getCameraReports().then((res) => {
            if (alive && res?.success) setReports(res.data?.reports || []);
        });
        adminService.getCameraReactions().then((res) => {
            if (alive && res?.success) setComplained((res.data || []).filter((c) => c.dislikes > 0));
        });
        return () => { alive = false; };
    }, []);

    const close = useCallback(async (id) => {
        setClosingId(id);
        const res = await adminService.updateCameraReport(id, 'selesai');
        setClosingId(null);
        if (res?.success) {
            setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'selesai' } : r)));
        }
    }, []);

    const open = reports.filter((report) => report.status !== 'selesai');
    if (!open.length && !complained.length) return null;

    const shownComplaints = complained.slice(0, MAX_COMPLAINED_ROWS);

    return (
        <Card>
            <CardHeader
                title={<span className="text-sm font-semibold text-content">Masukan pengunjung</span>}
                description="Hanya terlihat di sini — laporan dan penilaian negatif tidak pernah ditampilkan di halaman publik."
            />

            {open.length > 0 && (
                <section className="mt-3">
                    <h3 className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">
                        {open.length} laporan belum ditutup
                    </h3>
                    <ul className="mt-2 divide-y divide-edge">
                        {open.map((report) => (
                            <li key={report.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                        <span className="text-sm font-medium text-content">{report.cameraName}</span>
                                        {report.areaName && (
                                            <span className="text-xs text-content-subtle">{report.areaName}</span>
                                        )}
                                        <Badge tone="warn">{report.categoryLabel}</Badge>
                                        <span className="text-[11px] tabular-nums text-content-muted">
                                            {when(report.createdAt)}
                                        </span>
                                    </div>
                                    {/*
                                      * The incident time is stated as the reporter wrote it, not
                                      * reformatted: it is a wall-clock guess from a phone, and
                                      * dressing it up as a precise instant would overstate it.
                                      *
                                      * As a LINK it stops being a note and becomes the point of the
                                      * whole feature — one click opens admin playback on that
                                      * moment instead of leaving the operator to scrub for it.
                                      */}
                                    {report.occurredAt && (
                                        <p className="text-[11px] text-content-muted">
                                            Kejadian sekitar:{' '}
                                            {momentPath(report) ? (
                                                <a
                                                    href={momentPath(report)}
                                                    className="font-medium text-primary underline underline-offset-2"
                                                >
                                                    {report.occurredAt}
                                                </a>
                                            ) : report.occurredAt}
                                        </p>
                                    )}
                                    {report.message && (
                                        <p className="mt-0.5 break-words text-xs leading-5 text-content-muted">
                                            {report.message}
                                        </p>
                                    )}
                                </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    loading={closingId === report.id}
                                    onClick={() => close(report.id)}
                                >
                                    Selesai
                                </Button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {complained.length > 0 && (
                <section className="mt-4 border-t border-edge pt-3">
                    <h3 className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">
                        {complained.length} kamera ditandai bermasalah
                    </h3>
                    <ul className="mt-2 divide-y divide-edge">
                        {shownComplaints.map((camera) => (
                            <li key={camera.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                                <span className="text-sm font-medium text-content">{camera.name}</span>
                                {camera.areaName && (
                                    <span className="text-xs text-content-subtle">{camera.areaName}</span>
                                )}
                                <Badge tone="warn">{camera.dislikes} bermasalah</Badge>
                                {camera.likes > 0 && <Badge tone="idle">{camera.likes} bagus</Badge>}
                            </li>
                        ))}
                    </ul>
                    {/* Never truncate quietly: a capped list that does not say so reads as everything. */}
                    {complained.length > shownComplaints.length && (
                        <p className="mt-2 text-xs text-content-subtle">
                            Menampilkan {shownComplaints.length} terburuk dari {complained.length} kamera.
                        </p>
                    )}
                </section>
            )}
        </Card>
    );
}
