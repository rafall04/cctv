/*
 * Purpose: The operator's side of visitor feedback — what people reported, and which cameras they
 *          are voting down.
 * Caller: pages/CameraManagement.jsx.
 * Deps: adminService (camera reports + reaction summary), components/ui.
 * MainFuncs: CameraFeedbackPanel.
 * SideEffects: Two GETs on mount; one PUT when a report is closed.
 *
 * A SUMMARY, not the archive. It shows only what is still open and only the worst few, then hands
 * off to /admin/camera-reports and /admin/camera-reactions for everything else. Putting the full
 * queue here would bury camera CRUD — the reason anyone opened this page — under a list that grows
 * without limit.
 *
 * Silent when there is nothing open, like DeadSourcePanel: a permanent "0 laporan" box on the
 * busiest admin page teaches people to skip the region where the real warning appears.
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader } from '../../ui';
import { adminService } from '../../../services/adminService';
import { buildPlaybackMomentPath } from '../../../utils/playbackUrlState';
import { useTimezone, TIMESTAMP_STORAGE } from '../../../contexts/TimezoneContext.jsx';

const MAX_COMPLAINED_ROWS = 5;
const MAX_REPORT_ROWS = 5;

/* Admin playback, not the public one: staff should land with full reach, not the 10-minute preview. */
const momentPath = (report) => buildPlaybackMomentPath({
    camera: report.cameraId,
    occurredAt: report.occurredAt,
    basePath: '/admin/playback',
});

export default function CameraFeedbackPanel() {
    const { formatDateTime } = useTimezone();
    // createdAt is a UTC SQL datetime('now') column — render in the CONFIGURED tz, not the browser's
    // (a naive new Date() read it 7h early even for a WIB admin).
    const when = (value) => (value
        ? formatDateTime(value, { storage: TIMESTAMP_STORAGE.UTC_SQL, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '');
    const [reports, setReports] = useState([]);
    const [complained, setComplained] = useState([]);
    const [closingId, setClosingId] = useState(null);

    const [openTotal, setOpenTotal] = useState(0);

    useEffect(() => {
        let alive = true;
        // Only the open ones, and only a handful: the full queue lives at /admin/camera-reports.
        adminService.getCameraReports({ status: 'open', limit: MAX_REPORT_ROWS }).then((res) => {
            if (!alive || !res?.success) return;
            setReports(res.data?.reports || []);
            setOpenTotal(res.data?.summary?.open ?? (res.data?.reports || []).length);
        });
        adminService.getCameraReactions().then((res) => {
            if (alive && res?.success) setComplained((res.data?.cameras || []).filter((c) => c.dislikes > 0));
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
                        {openTotal} laporan belum ditutup
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

            {/*
              * The way out of a deliberately partial view. Without these the caps above would read
              * as the whole story — the same failure the truncation notes exist to prevent.
              */}
            <div className="mt-4 flex flex-wrap gap-3 border-t border-edge pt-3">
                <a href="/admin/camera-reports" className="text-xs font-medium text-primary underline underline-offset-2">
                    Buka semua laporan
                </a>
                <a href="/admin/camera-reactions" className="text-xs font-medium text-primary underline underline-offset-2">
                    Buka penilaian semua kamera
                </a>
            </div>
        </Card>
    );
}
