/*
 * Purpose: Let a visitor say whether a camera is any good, in one tap, without an account.
 * Caller: components/MultiView/CameraDetailPanel.jsx (inside the public video popup).
 * Deps: cameraFeedbackService.
 * MainFuncs: CameraReactionBar.
 * SideEffects: One GET per camera opened; one POST per tap.
 *
 * BOTH COUNTS ARE SHOWN — OWNER'S DECISION, 2026-08-02
 * The first cut printed likes only. The owner overruled it so the page says what visitors actually
 * reported: a camera whose picture has gone useless is a fact about what someone is being offered,
 * and showing the praise while hiding the complaints turns the counter into an advertisement.
 * The voter also sees their own choice, or the button could not show its state.
 *
 * FAILURE IS SILENCE
 * This sits directly under a live player. A feedback endpoint that is down must not render an
 * error next to the video — the bar simply does not appear.
 */

import { useCallback, useEffect, useState } from 'react';
import cameraFeedbackService from '../../services/cameraFeedbackService';

const BASE = 'inline-flex items-center gap-1.5 rounded-control border px-3 py-2 text-xs font-medium transition-colors';
const IDLE = 'border-edge text-content-muted hover:border-edge-strong hover:bg-surface-raised';
const ACTIVE = 'border-primary bg-primary/10 text-primary';

/*
 * SVG, BUKAN EMOJI 👍/👎 — diganti 2026-08-14.
 *
 * Alasan yang menentukan bukan selera: emoji tidak ikut mewarisi warna tombol. Emoji digambar
 * oleh fon sistem dengan warnanya sendiri, jadi saat tombol berpindah ke keadaan terpilih
 * (`text-primary`) jempolnya tetap kuning — keadaan aktif hanya terbaca dari bingkai dan latar,
 * setengah dari sinyalnya hilang. SVG di bawah memakai `currentColor`, sehingga ikut berubah
 * bersama teksnya.
 *
 * Dua alasan lain: rupa emoji berbeda-beda antar sistem (Android, iOS, Windows menggambar
 * jempol yang tidak mirip satu sama lain, dan sebagian memakai warna kulit bawaan), dan
 * ukurannya tidak mengikuti skala ikon lain di kartu yang sama.
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

export default function CameraReactionBar({ cameraId }) {
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

    /* Tapping the side you already chose withdraws it — the same button is the undo. */
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
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="camera-reaction-bar">
            <button
                type="button"
                onClick={() => vote(1)}
                disabled={busy}
                aria-pressed={state.myValue === 1}
                aria-label="Kamera ini bagus"
                className={`${BASE} ${state.myValue === 1 ? ACTIVE : IDLE} disabled:opacity-60`}
            >
                <IkonJempol />
                <span>Bagus</span>
                {/*
                  * Counts are omitted at zero rather than printed as "0". On a fresh install all 36
                  * cameras would otherwise show a row of zeroes, which reads as a verdict ("nobody
                  * rates anything here") when the truth is that nobody has voted yet.
                  */}
                {state.likes > 0 && <span className="tabular-nums">{state.likes}</span>}
            </button>

            <button
                type="button"
                onClick={() => vote(-1)}
                disabled={busy}
                aria-pressed={state.myValue === -1}
                aria-label="Kamera ini bermasalah"
                className={`${BASE} ${state.myValue === -1 ? ACTIVE : IDLE} disabled:opacity-60`}
            >
                {/* Jempol ke bawah = jempol ke atas diputar 180°, sama seperti pasangan ikon
                    Lucide aslinya — bukan jalan pintas, kedua ikon itu memang saling berputar. */}
                <IkonJempol kebawah />
                <span>Bermasalah</span>
                {state.dislikes > 0 && <span className="tabular-nums">{state.dislikes}</span>}
            </button>

            {state.myValue !== 0 && (
                <span className="text-[11px] text-content-subtle">Tersimpan · ketuk lagi untuk batal</span>
            )}
        </div>
    );
}
