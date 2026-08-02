/*
 * Purpose: Surface the cameras visitors are complaining about — the only place the negative vote
 *          is ever shown.
 * Caller: pages/CameraManagement.jsx.
 * Deps: adminService.getCameraReactions, components/ui.
 * MainFuncs: CameraFeedbackPanel.
 * SideEffects: One GET on mount.
 *
 * The public bar deliberately prints likes only (see CameraReactionBar). Collecting a signal that
 * nobody reads would be worse than not collecting it, so this panel is the other half of that
 * decision: "camera 25 — 30 bermasalah, 2 bagus" is a maintenance ticket nothing else raises.
 *
 * Silent while nobody is complaining, for the same reason DeadSourcePanel is: a permanent
 * "0 keluhan" box teaches people to skip the region where the warning eventually appears.
 */

import { useEffect, useState } from 'react';
import { Badge, Card, CardHeader } from '../../ui';
import { adminService } from '../../../services/adminService';

const MAX_ROWS = 10;

export default function CameraFeedbackPanel() {
    const [cameras, setCameras] = useState(null);

    useEffect(() => {
        let alive = true;
        adminService.getCameraReactions().then((res) => {
            if (alive && res?.success) setCameras(res.data || []);
        });
        return () => { alive = false; };
    }, []);

    const complained = (cameras || []).filter((camera) => camera.dislikes > 0);
    if (!complained.length) return null;

    const shown = complained.slice(0, MAX_ROWS);

    return (
        <Card>
            <CardHeader
                title={(
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-content">
                            {complained.length} kamera dikeluhkan pengunjung
                        </span>
                    </span>
                )}
                description="Pengunjung menandai kamera ini bermasalah — biasanya gambar buram, gelap, atau tidak tampil. Angka ini tidak pernah ditampilkan di halaman publik."
            />

            <ul className="mt-3 divide-y divide-edge">
                {shown.map((camera) => (
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

            {/* Never truncate quietly: a capped list that does not say so reads as the whole story. */}
            {complained.length > shown.length && (
                <p className="mt-3 text-xs text-content-subtle">
                    Menampilkan {shown.length} terburuk dari {complained.length} kamera yang dikeluhkan.
                </p>
            )}
        </Card>
    );
}
