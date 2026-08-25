/*
 * Purpose: Let a visitor report a specific problem, or a specific incident, on the camera they are
 *          watching — without any of it becoming a public post.
 * Caller: components/MultiView/CameraDetailPanel.jsx (inside the public video popup).
 * Deps: cameraFeedbackService.
 * MainFuncs: CameraReportForm.
 * SideEffects: One GET for the category list on first open; one POST per submission.
 *
 * THE TRIGGER LEFT, THE FORM STAYED — 2026-08-21
 * Opening this used to be an underlined link on a line of its own, the third stacked row of
 * controls under the video. The trigger is now the "Lapor" chip in the panel's single action row,
 * so `open` is owned by the panel and arrives as a prop; everything below the row — the category
 * list, the incident time, the submit, the reset-on-camera-change — is unchanged and still lives
 * here. Only the button moved.
 *
 * INLINE, NOT A MODAL — ON PURPOSE
 * Public components on this site carry raw high z-index values that have outranked every modal
 * before (the public dock once covered dialogs outright). An inline disclosure inside the panel
 * cannot lose that fight because it never enters it.
 *
 * COLLAPSED BY DEFAULT
 * The page exists to show a picture. A form that is always open pushes the video further down the
 * phone screen for the majority who have nothing to report.
 */

import { useCallback, useEffect, useState } from 'react';
import cameraFeedbackService from '../../services/cameraFeedbackService';

/* The list is identical for every visitor and never changes within a session. */
let cachedCategories = null;

const CHIP = 'rounded-control border px-2.5 py-1.5 text-xs font-medium transition-colors';
const CHIP_IDLE = 'border-edge text-content-muted hover:border-edge-strong';
/* `bg-primary-100` and not `bg-primary/10`: --primary-color is a bare CSS variable, so Tailwind
   cannot compute alpha for it and the /10 form compiled to nothing. See common/ActionChip.jsx. */
const CHIP_ON = 'border-primary bg-primary-100 text-primary';

export default function CameraReportForm({ cameraId, open = false, onClose }) {
    const [categories, setCategories] = useState(cachedCategories);
    const [category, setCategory] = useState('');
    const [message, setMessage] = useState('');
    const [occurredAt, setOccurredAt] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    /* Everything resets when the popup moves to another camera — a half-typed report about one
       feed must never be submitted against a different one. (`open` resets in the panel, which
       owns it now.) */
    useEffect(() => {
        setCategory('');
        setMessage('');
        setOccurredAt('');
        setResult(null);
    }, [cameraId]);

    /* Reopening after a send starts clean: the thank-you belongs to the report that was sent, and
       leaving it up would turn the chip into a dead control for anyone with a second thing to
       report on the same camera. */
    useEffect(() => {
        if (open) setResult(null);
    }, [open]);

    useEffect(() => {
        if (!open || categories) return undefined;
        let alive = true;
        cameraFeedbackService.getReportCategories().then((res) => {
            if (!alive || !res?.success) return;
            cachedCategories = res.data;
            setCategories(res.data);
        });
        return () => { alive = false; };
    }, [open, categories]);

    const submit = useCallback(async (event) => {
        event.preventDefault();
        if (!category || busy) return;

        setBusy(true);
        const res = await cameraFeedbackService.submitReport(cameraId, {
            category,
            message: message.trim() || null,
            occurredAt: category === 'kejadian' && occurredAt ? occurredAt : null,
        });
        setBusy(false);

        if (res?.success) {
            setResult({ ok: true, message: res.message || 'Laporan terkirim. Terima kasih.' });
            onClose?.();
            return;
        }
        // The server's own Indonesian message says what to fix ("pilih Lainnya hanya kalau…",
        // "terlalu banyak laporan"); replacing it with a generic failure would lose that.
        setResult({ ok: false, message: res?.message || 'Gagal mengirim laporan' });
    }, [busy, cameraId, category, message, occurredAt, onClose]);

    if (result?.ok) {
        return (
            <p className="mt-2 text-[11px] text-content-muted" role="status">
                {result.message}
            </p>
        );
    }

    /* Closed renders nothing at all — the chip in the row above IS the trigger now. */
    if (!open) return null;

    return (
        <form onSubmit={submit} className="mt-2 rounded-control border border-edge bg-surface-sunken p-3">
            <fieldset>
                <legend className="text-[11px] font-medium text-content-subtle">Apa yang terjadi?</legend>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {(categories || []).map((option) => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => setCategory(option.key)}
                            aria-pressed={category === option.key}
                            className={`${CHIP} ${category === option.key ? CHIP_ON : CHIP_IDLE}`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </fieldset>

            {/* Only an incident has a time worth asking for; a blurry lens does not happen at 14.30. */}
            {category === 'kejadian' && (
                <label className="mt-3 block text-[11px] text-content-subtle">
                    Perkiraan waktu kejadian (opsional)
                    <input
                        type="datetime-local"
                        value={occurredAt}
                        onChange={(event) => setOccurredAt(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-control border border-edge bg-surface px-2 py-1.5 text-base text-content sm:min-h-0 sm:text-sm"
                    />
                </label>
            )}

            <label className="mt-3 block text-[11px] text-content-subtle">
                Keterangan {category === 'lainnya' ? '(wajib)' : '(opsional)'}
                <textarea
                    rows={2}
                    maxLength={500}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    className="mt-1 w-full rounded-control border border-edge bg-surface px-2 py-1.5 text-base text-content sm:text-sm"
                />
            </label>

            {result && !result.ok && (
                <p className="mt-2 text-[11px] text-status-warn" role="alert">{result.message}</p>
            )}

            <p className="mt-2 text-[11px] leading-4 text-content-subtle">
                Laporan ini hanya dibaca pengelola, tidak ditampilkan di halaman.
            </p>

            <div className="mt-2 flex items-center gap-2">
                <button
                    type="submit"
                    disabled={!category || busy}
                    className="rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                    {busy ? 'Mengirim…' : 'Kirim'}
                </button>
                <button
                    type="button"
                    onClick={() => onClose?.()}
                    className="rounded-control border border-edge px-3 py-1.5 text-xs font-medium text-content-muted"
                >
                    Batal
                </button>
            </div>
        </form>
    );
}
