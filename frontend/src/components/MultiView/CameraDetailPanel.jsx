/*
 * Purpose: Render minimal public camera metadata and every popup action as ONE scrolling chip row
 *          directly under the live video.
 * Caller: VideoPopup public single-camera modal.
 * Deps: landingCameraInsights, publicGrowthShare, common/ActionChip, CameraReactionBar,
 *       CameraReportForm, CameraVehicleCountPanel, SupportInlineNote.
 * MainFuncs: CameraDetailPanel.
 * SideEffects: Invokes share and favorite callbacks; owns the report form's open/closed state.
 *
 * WHY ONE ROW — 2026-08-21
 * Two screenshots from a real Android phone settled this. Under the video sat THREE separate rows
 * of controls: "Bagikan / Tambah favorit / Buka area", then "Bagus / Bermasalah", then an
 * underlined "Laporkan masalah pada kamera ini" on a line of its own. Each was reasonable where it
 * was written; together they pushed the camera's own identity — the area name, whether anyone is
 * watching, whether playback exists — below the fold on the page that exists to state it. Three
 * rows of chrome for one video also reads as three unrelated groups of controls rather than "the
 * things you can do here". They are now one row, in one order, in one appearance (ActionChip).
 *
 * WHY IT SCROLLS INSTEAD OF WRAPPING
 * A wrapping row is the same disease with an extra step: at Android's 1.3× font scaling six chips
 * wrap to two lines, and on a narrow phone to three — the video is pushed down again, and the
 * height of the panel changes with the user's font setting, so nothing below it sits where the
 * layout was designed for. A horizontal scroller has ONE height at every font scale, and a chip
 * clipped at the right edge is itself the affordance that there is more (this is exactly YouTube's
 * mobile pattern, and visitors already read it). `[contain:paint]` is not decoration: without it a
 * horizontal strip's overflow reaches the document's scrollable rect even through clipping
 * ancestors, and in-app WebViews then zoom the whole page out to fit it — the 2026-07 mobile
 * incident. `-mx-3 px-3` bleeds the scroll area to the panel edges without any viewport unit, so
 * the page itself never gains a horizontal scrollbar.
 *
 * ORDER IS FREQUENCY, NOT SENIORITY
 * Bagus, Bermasalah, Bagikan, Favorit, Area, Lapor. The two one-tap judgements come first because
 * they are the ones most visitors use and the only ones with nothing to read first; "Lapor" is
 * last because it opens a form and the people who need it are looking for it.
 *
 * "BAGIKAN" HERE SHARES THE CAMERA
 * The shop card below has its own share, for the ITEM. Two controls with the same word, a screen
 * apart, is ambiguous — so this one carries aria-label="Bagikan kamera ini" and the shop's is
 * icon-only with aria-label="Bagikan barang". Visually the context does the work; for a screen
 * reader and for a long-press tooltip, the labels do.
 */

import { useEffect, useState } from 'react';

import { getPublicCameraQuality } from '../../utils/landingCameraInsights';
import { buildAreaPath } from '../../utils/publicGrowthShare';
import ActionChip from '../common/ActionChip.jsx';
import { formatCompactCount } from '../common/CameraViewerStatsBadges.jsx';
import CameraReactionBar from './CameraReactionBar.jsx';
import CameraReportForm from './CameraReportForm.jsx';
import CameraVehicleCountPanel from './CameraVehicleCountPanel.jsx';
import SupportInlineNote from './SupportInlineNote.jsx';

function metric(camera, key) {
    return Number(camera?.[key] ?? camera?.viewer_stats?.[key] ?? 0);
}

/*
 * Colour for a quality key lives here, in the presentation layer, instead of being baked into the
 * data helper. Only states that mean something get a colour: a fault is red, a warning amber,
 * everything else stays quiet text so the row does not turn into five competing pills again.
 */
const QUALITY_TONE = {
    maintenance: 'text-status-fault',
    offline: 'text-status-idle',
    busy: 'text-status-live',
};

/* One stroke geometry for every chip icon, so they sit on the same optical baseline and inherit
   the chip's colour through currentColor (an emoji would not — see CameraReactionBar). */
function ChipIcon({ filled = false, children }) {
    return (
        <svg
            className="h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {children}
        </svg>
    );
}

const IkonBagikan = () => (
    <ChipIcon>
        <path d="M12 15V3" />
        <path d="m8 7 4-4 4 4" />
        <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
    </ChipIcon>
);

/* The star FILLS when the camera is a favourite. That is the chip's own extra signal, carried by
   the icon rather than by a second colour scheme — see the "no second pressed look" note in
   ActionChip. */
const IkonBintang = ({ terisi }) => (
    <ChipIcon filled={terisi}>
        <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9z" />
    </ChipIcon>
);

const IkonArea = () => (
    <ChipIcon>
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0" />
        <circle cx="12" cy="10" r="3" />
    </ChipIcon>
);

const IkonLapor = () => (
    <ChipIcon>
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <path d="M4 22v-7" />
    </ChipIcon>
);

export default function CameraDetailPanel({
    camera,
    isFavorite = false,
    onShare,
    onToggleFavorite,
}) {
    /* The report form's disclosure state lives here because its TRIGGER lives here — the chip is in
       the row, the form renders under it. The form still owns everything else about itself. */
    const [reportOpen, setReportOpen] = useState(false);
    /* A boolean handed up by CameraReactionBar: "this visitor's vote is recorded". The bar cannot
       print the hint itself without putting it inside the scroller, where it would be off-screen. */
    const [reactionSaved, setReactionSaved] = useState(false);

    const cameraId = camera?.id;

    /* A half-open report form must never survive a jump to another camera. */
    useEffect(() => {
        setReportOpen(false);
    }, [cameraId]);

    const quality = getPublicCameraQuality(camera);
    const liveViewers = metric(camera, 'live_viewers');
    const totalViews = metric(camera, 'total_views');
    const hasPlayback = camera?.enable_recording === 1 || camera?.enable_recording === true;
    const areaName = camera?.area_name || camera?.areaName || 'Area publik';

    return (
        <section
            data-testid="camera-detail-panel"
            className="border-b border-edge bg-surface px-3 py-2.5"
        >
            {/* Five filled pills became one line of text separated by dots. The counts are ambient
                context for the video above them, not headlines. This line is now the FIRST thing
                under the video, which is the whole point of collapsing the three button rows. */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="max-w-[13rem] truncate text-sm font-semibold text-content sm:max-w-xs">
                    {areaName}
                </span>
                <span className="text-content-subtle" aria-hidden="true">·</span>
                <span className={`font-medium ${QUALITY_TONE[quality.key] || 'text-content-muted'}`}>
                    {quality.label}
                </span>
                <span className="text-content-subtle" aria-hidden="true">·</span>
                {/* Compact form, shared with the camera cards: this row is the ONLY place the popup
                    states the counts (the header used to repeat them), so it has to be the one that
                    reads well at 21500 → "21.5k". */}
                <span className="tabular-nums text-content-muted">{formatCompactCount(liveViewers)} live</span>
                <span className="text-content-subtle" aria-hidden="true">·</span>
                <span className="tabular-nums text-content-muted">{formatCompactCount(totalViews)} views</span>
                {hasPlayback && (
                    <>
                        <span className="text-content-subtle" aria-hidden="true">·</span>
                        <span className="text-content-muted">Playback tersedia</span>
                    </>
                )}
            </div>

            {/* THE row. no-scrollbar because a permanent horizontal scrollbar under a video looks
                like breakage on desktop; the clipped chip on the right is the affordance instead.
                overscroll-x-contain stops a flick at the end of the row from turning into the
                browser's back gesture on Android. py-0.5 keeps focus rings off the clip edge. */}
            <div
                data-testid="camera-action-row"
                className="no-scrollbar -mx-3 mt-2 flex min-w-0 max-w-full items-center gap-2 overflow-x-auto overscroll-x-contain px-3 py-0.5 [contain:paint] [-webkit-overflow-scrolling:touch]"
            >
                {/* Renders two chips, or nothing at all if the feedback endpoint is down. The rest
                    of the row is unaffected either way. */}
                <CameraReactionBar cameraId={cameraId} onSavedChange={setReactionSaved} />

                <ActionChip
                    testId="camera-action-share"
                    icon={<IkonBagikan />}
                    label="Bagikan"
                    onClick={onShare}
                    ariaLabel="Bagikan kamera ini"
                    title="Bagikan kamera ini"
                />

                {onToggleFavorite && (
                    <ActionChip
                        testId="camera-action-favorite"
                        icon={<IkonBintang terisi={isFavorite} />}
                        label="Favorit"
                        pressed={isFavorite}
                        onClick={() => onToggleFavorite(camera.id)}
                        /* The visible label stays one word in both states so the chip does not
                           change width — and jog the whole row — every time it is tapped. The
                           state is carried by the filled star, the pressed styling, aria-pressed
                           and this label. */
                        ariaLabel={isFavorite ? 'Hapus kamera ini dari favorit' : 'Tambah kamera ini ke favorit'}
                        title={isFavorite ? 'Hapus dari favorit' : 'Tambah ke favorit'}
                    />
                )}

                {/* href, so this stays a real link: middle-click, long-press → buka di tab baru, and
                    salin alamat tautan all keep working. */}
                <ActionChip
                    testId="camera-action-area"
                    icon={<IkonArea />}
                    label="Area"
                    href={buildAreaPath(camera)}
                    ariaLabel="Buka area"
                    title="Buka halaman area"
                />

                <ActionChip
                    testId="camera-action-report"
                    icon={<IkonLapor />}
                    label="Lapor"
                    pressed={reportOpen}
                    onClick={() => setReportOpen((wasOpen) => !wasOpen)}
                    ariaLabel="Laporkan masalah pada kamera ini"
                    title="Laporkan masalah pada kamera ini"
                />
            </div>

            {/* Under the row, not inside it: this is what tells a visitor the tap registered and
                that it can be taken back. Inside a scroller it would sit past the right edge of a
                360px phone, which is the same as deleting it. */}
            {reactionSaved && (
                <p className="mt-1.5 text-[11px] text-content-subtle" role="status">
                    Tersimpan · ketuk lagi untuk batal
                </p>
            )}

            {/* Directly beneath its own chip — a disclosure that opens somewhere else is a jump
                cut. Renders nothing while closed. */}
            <CameraReportForm
                cameraId={cameraId}
                open={reportOpen}
                onClose={() => setReportOpen(false)}
            />

            {/*
              * Hitung kendaraan otomatis: pertama setelah baris tindakan, karena INILAH isi yang
              * membuat orang berhenti di kamera ini — dan hanya kamera yang benar-benar dipasangi
              * penghitung yang merendernya, sisanya null (tidak ada kotak kosong di 35 kamera lain).
              */}
            <CameraVehicleCountPanel cameraId={cameraId} />

            {/*
              * Last thing in the panel, above the related-cameras strip: the visitor has the
              * stream, the actions and the feedback controls before they reach the ask, so it
              * reads as a footnote to the experience rather than a toll on it.
              */}
            <SupportInlineNote />
        </section>
    );
}
