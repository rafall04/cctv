/*
 * Purpose: Show whether playback access is held, how far it reaches, and let it be swapped or left.
 * Caller: Playback page (normal and denied states).
 * Deps: React state only; every action is a prop callback.
 * MainFuncs: PlaybackTokenAccess.
 * SideEffects: Invokes token activation/clear callbacks from props.
 *
 * WHAT WAS WRONG
 * One form served both states at once. A visitor who already held access still faced a password box
 * and an "Aktifkan" button, with the facts flattened into a run-on line — "Token aktif tanpa tanggal
 * kedaluwarsa - Akses: 14 kamera - Window: 4 jam terakhir" — and the only way out labelled "Hapus",
 * which reads as destroying the token rather than signing out of it.
 *
 * WHY IT KEYS OFF THE POLICY, NOT ONLY tokenStatus
 * tokenStatus exists only when THIS page load performed an activation. A visitor returning on a live
 * cookie — no key in the URL — has real access and an empty tokenStatus, and would have been shown
 * the "enter a token" form while already holding one. playback_policy is the server's own verdict
 * for the camera on screen, so it is the honest source for "do I have access, and how far back".
 */

import { useState, useEffect } from 'react';
import PlaybackAccessPanel from './PlaybackAccessPanel.jsx';

/** One labelled fact. Stacking these beats a run-on sentence: each value is findable at a glance. */
function Fact({ label, value }) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">{label}</dt>
            <dd className="truncate text-sm font-medium text-content">{value}</dd>
        </div>
    );
}

export default function PlaybackTokenAccess({
    tokenInput,
    onTokenInputChange,
    onActivate,
    onClear,
    isBusy,
    tokenStatus,
    message,
    playbackPolicy = null,
    compact = false,
}) {
    const [showAccess, setShowAccess] = useState(false);
    /** Set by "Ganti token": the only way the form returns while access is still held. */
    const [isSwapping, setIsSwapping] = useState(false);

    /*
     * The capped-playback notice sits far above this box, so its call to action has to do two things
     * at once: open the panel AND bring it into view. Scrolling alone left the visitor staring at a
     * collapsed toggle, which reads as a dead button.
     *
     * requestAnimationFrame because the panel does not exist in the DOM until this state flips —
     * scrolling in the same tick would target the collapsed box and land short.
     */
    useEffect(() => {
        const open = () => {
            setShowAccess(true);
            requestAnimationFrame(() => {
                document.getElementById('akses-playback')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        };
        window.addEventListener('playback:open-access', open);
        return () => window.removeEventListener('playback:open-access', open);
    }, []);

    const hasAccess = playbackPolicy?.accessMode === 'token_full' || Boolean(tokenStatus);

    /*
     * Leaving must also close the swap form. Without this, signing out from inside "Ganti token" left
     * the box open over a now-anonymous session, which reads as though the sign-out failed.
     */
    useEffect(() => {
        if (!hasAccess) {
            setIsSwapping(false);
        }
    }, [hasAccess]);

    const handleSubmit = (event) => {
        event.preventDefault();
        onActivate(tokenInput);
    };

    const cameraCount = tokenStatus?.allowed_camera_ids?.length || tokenStatus?.camera_ids?.length || 0;
    // The server's per-camera verdict wins; the activation payload is only a fallback for the moment
    // before the first policy arrives.
    const windowHours = playbackPolicy?.playbackWindowHours
        ?? (tokenStatus?.effective_playback_window_hours
            || tokenStatus?.playback_window_hours
            || tokenStatus?.camera_rules?.find((rule) => rule?.playback_window_hours)?.playback_window_hours
            || null);

    const scopeLabel = () => {
        if (cameraCount > 0) {
            return `${cameraCount} kamera`;
        }
        return tokenStatus?.scope_type === 'area' ? 'Per area' : 'Semua kamera';
    };

    if (hasAccess && !isSwapping) {
        return (
            <section className={`rounded-card border border-edge bg-surface p-3 sm:p-4 ${compact ? 'w-full' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-status-live" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-content">Akses playback aktif</h2>
                    {tokenStatus?.label && (
                        <span className="truncate text-xs text-content-muted">{tokenStatus.label}</span>
                    )}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Fact label="Jangkauan" value={windowHours ? `${windowHours} jam terakhir` : 'Semua rekaman'} />
                    <Fact label="Cakupan" value={scopeLabel()} />
                    <Fact
                        label="Berlaku"
                        value={tokenStatus?.expires_at ? `Sampai ${tokenStatus.expires_at}` : 'Selamanya'}
                    />
                </dl>

                <p className="mt-3 text-xs leading-5 text-content-muted">
                    {windowHours
                        ? `Rekaman yang lebih lama dari ${windowHours} jam ke belakang tidak ditampilkan.`
                        : 'Seluruh rekaman yang masih tersimpan bisa diputar.'}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => { setIsSwapping(true); onTokenInputChange(''); }}
                        disabled={isBusy}
                        className="rounded-control border border-edge px-3 py-2 text-sm font-medium text-content transition hover:bg-surface-raised disabled:opacity-60"
                    >
                        Ganti token
                    </button>
                    {/*
                     * "Keluar", not "Hapus". The old label read as destroying the token itself, which
                     * is an admin action and irreversible — a frightening thing to offer a viewer for
                     * what is only signing out of this browser.
                     */}
                    <button
                        type="button"
                        onClick={onClear}
                        disabled={isBusy}
                        className="rounded-control border border-edge px-3 py-2 text-sm font-medium text-content-muted transition hover:bg-surface-raised disabled:opacity-60"
                    >
                        Keluar dari token
                    </button>
                </div>

                {message && <p className="mt-2 text-xs text-content-muted">{message}</p>}
            </section>
        );
    }

    return (
        <form
            onSubmit={handleSubmit}
            className={`rounded-card border border-edge bg-surface p-3 sm:p-4 ${compact ? 'w-full' : ''}`}
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                    <label
                        htmlFor="playback-token-input"
                        className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-content-subtle"
                    >
                        {isSwapping ? 'Ganti ke token lain' : 'Token playback'}
                    </label>
                    <input
                        id="playback-token-input"
                        type="password"
                        value={tokenInput}
                        onChange={(event) => onTokenInputChange(event.target.value)}
                        placeholder="Masukkan token akses"
                        className="w-full rounded-control border border-edge bg-surface-raised px-3 py-2 text-sm text-content outline-none focus:border-primary"
                    />
                    {/*
                     * The one moment a visitor is being asked for something they may not have, so the
                     * way to get one belongs here — expanded in place, never linking away: a separate
                     * page stripped the app shell AND navigated them off the player they were trying
                     * to unlock.
                     *
                     * onIssued closes the loop: the key we just minted goes straight into the input
                     * and activates, so the visitor never has to read and retype what the app
                     * already knows. It stays on screen only because it is worth copying elsewhere.
                     */}
                    {!isSwapping && (
                        <div id="akses-playback">
                            <button
                                type="button"
                                onClick={() => setShowAccess((v) => !v)}
                                className="mt-1 text-xs text-content-muted underline-offset-2 hover:underline"
                            >
                                Belum punya token?{' '}
                                <span className="font-medium text-primary">
                                    {showAccess ? 'Tutup' : 'Coba gratis 3 hari atau beli akses'}
                                </span>
                            </button>
                            {showAccess && (
                                <PlaybackAccessPanel
                                    onIssued={(key) => { onTokenInputChange(key); onActivate(key); }}
                                />
                            )}
                        </div>
                    )}
                </div>
                <div className="flex gap-2">
                    <button
                        type="submit"
                        disabled={isBusy || !tokenInput.trim()}
                        className="rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Aktifkan
                    </button>
                    {/* Only reachable while access is still held, so backing out is never a dead end. */}
                    {isSwapping && (
                        <button
                            type="button"
                            onClick={() => setIsSwapping(false)}
                            disabled={isBusy}
                            className="rounded-control border border-edge px-4 py-2 text-sm font-medium text-content-muted transition hover:bg-surface-raised disabled:opacity-60"
                        >
                            Batal
                        </button>
                    )}
                </div>
            </div>
            {message && <p className="mt-2 text-xs text-content-muted">{message}</p>}
        </form>
    );
}
