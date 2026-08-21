/*
 * Purpose: Let a visitor say whether a camera is any good, in one tap, without an account.
 * Caller: components/MultiView/CameraDetailPanel.jsx — rendered INSIDE the action chip row.
 * Deps: cameraFeedbackService, common/ActionChip.
 * MainFuncs: CameraReactionBar.
 * SideEffects: One GET per camera opened; one POST per tap; reports "vote saved" upward.
 *
 * IT RENDERS CHIPS, NOT A BAR — 2026-08-21
 * This used to be its own row of two bespoke buttons under the actions row, which under the video
 * on a phone meant a third stacked row of controls. It now returns a bare Fragment of two
 * ActionChips that the panel drops into its single wrapping row, so the vote is the FIRST thing
 * under the video instead of the third. The data and the optimistic state stayed here on purpose:
 * the panel composes the row, it does not fetch for it.
 *
 * ONE OF THE TWO KEEPS ITS WORD
 * "Bagus" is the only chip in the whole row that stays labelled below `sm`: it is the most-tapped
 * control there, and it is the one whose number is on screen — a bare digit next to a thumb, with
 * no word attached, is not a count of anything in particular. "Bermasalah" takes ActionChip's
 * `compact` like the four panel chips, which is what lets all six fit one line on a 375px phone
 * instead of scrolling two of them off the edge. Its count goes with its label below `sm` (the
 * chip must stay a 44px square) but NOT out of its accessible name — ActionChip appends it there,
 * so a screen reader still hears "Tandai kamera ini bermasalah, 2".
 *
 * BOTH COUNTS ARE SHOWN — OWNER'S DECISION, 2026-08-02
 * The first cut printed likes only. The owner overruled it so the page says what visitors actually
 * reported: a camera whose picture has gone useless is a fact about what someone is being offered,
 * and showing the praise while hiding the complaints turns the counter into an advertisement.
 * The voter also sees their own choice, or the chip could not show its state.
 *
 * FAILURE IS SILENCE
 * This sits directly under a live player. A feedback endpoint that is down must not render an
 * error next to the video — the two chips simply do not appear, and the rest of the row (Bagikan,
 * Favorit, Area, Lapor) is untouched because they are the panel's children, not ours.
 *
 * THE "TERSIMPAN" HINT LEFT THE ROW, NOT THE PAGE
 * It is the only thing that tells a visitor their tap registered AND that it is reversible, so it
 * had to survive. It cannot ride inside the chip row: a sentence among six chips is the item that
 * forces the row onto a second line, and it would then sit wherever the wrap put it rather than
 * under the chip that triggered it. So we hand the panel a boolean through `onSavedChange` and it
 * prints the line under the row, where it is actually read.
 */

import { useCallback, useEffect, useState } from 'react';
import ActionChip from '../common/ActionChip.jsx';
import cameraFeedbackService from '../../services/cameraFeedbackService';

/*
 * SVG, BUKAN EMOJI 👍/👎 — diganti 2026-08-14.
 *
 * Alasan yang menentukan bukan selera: emoji tidak ikut mewarisi warna tombol. Emoji digambar
 * oleh fon sistem dengan warnanya sendiri, jadi saat chip berpindah ke keadaan terpilih
 * (`text-primary`) jempolnya tetap kuning — keadaan aktif hanya terbaca dari bingkai dan latar,
 * setengah dari sinyalnya hilang. SVG di bawah memakai `currentColor`, sehingga ikut berubah
 * bersama teksnya.
 *
 * Dua alasan lain: rupa emoji berbeda-beda antar sistem (Android, iOS, Windows menggambar
 * jempol yang tidak mirip satu sama lain, dan sebagian memakai warna kulit bawaan), dan
 * ukurannya tidak mengikuti skala ikon lain di baris yang sama.
 */
function IkonJempol({ kebawah = false }) {
    return (
        <svg
            className={`h-4 w-4 shrink-0 ${kebawah ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            <path d="M7 10v12" />
            <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
        </svg>
    );
}

export default function CameraReactionBar({ cameraId, onSavedChange }) {
    const [state, setState] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!cameraId) return undefined;
        let alive = true;
        setState(null);
        cameraFeedbackService.getReaction(cameraId).then((res) => {
            if (alive && res?.success) setState(res.data);
        });
        return () => { alive = false; };
    }, [cameraId]);

    /* Every hook stays above the conditional return below — React error #310. */
    useEffect(() => {
        onSavedChange?.(Boolean(state && state.myValue !== 0));
    }, [state, onSavedChange]);

    /* Tapping the side you already chose withdraws it — the same chip is the undo. */
    const vote = useCallback(async (value) => {
        if (busy || !state) return;
        setBusy(true);
        const next = state.myValue === value ? 0 : value;
        const res = await cameraFeedbackService.setReaction(cameraId, next);
        if (res?.success) setState(res.data);
        setBusy(false);
    }, [busy, cameraId, state]);

    if (!state) return null;

    return (
        <>
            {/* No `compact`: this one keeps its word and its number at every width. */}
            <ActionChip
                testId="camera-reaction-like"
                icon={<IkonJempol />}
                label="Bagus"
                count={state.likes}
                pressed={state.myValue === 1}
                disabled={busy}
                onClick={() => vote(1)}
                ariaLabel="Kamera ini bagus"
                title="Kamera ini bagus"
            />
            {/* Jempol ke bawah = jempol ke atas diputar 180°, sama seperti pasangan ikon
                Lucide aslinya — bukan jalan pintas, kedua ikon itu memang saling berputar.
                "Bermasalah" is a REPORT control, not a fault state: it never turns red — and
                icon-only below `sm`, "Tandai …" is what stops the bare thumb from being read as an
                accusation the visitor did not intend to make. */}
            <ActionChip
                testId="camera-reaction-dislike"
                compact
                icon={<IkonJempol kebawah />}
                label="Bermasalah"
                count={state.dislikes}
                pressed={state.myValue === -1}
                disabled={busy}
                onClick={() => vote(-1)}
                ariaLabel="Tandai kamera ini bermasalah"
                title="Tandai kamera ini bermasalah"
            />
        </>
    );
}
