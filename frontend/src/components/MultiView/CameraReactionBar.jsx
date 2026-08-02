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
                <span aria-hidden="true">👍</span>
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
                <span aria-hidden="true">👎</span>
                <span>Bermasalah</span>
                {state.dislikes > 0 && <span className="tabular-nums">{state.dislikes}</span>}
            </button>

            {state.myValue !== 0 && (
                <span className="text-[11px] text-content-subtle">Tersimpan · ketuk lagi untuk batal</span>
            )}
        </div>
    );
}
