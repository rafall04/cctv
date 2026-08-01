/*
 * Purpose: Render compact public playback token controls for manual activation and active-token status.
 * Caller: Playback page normal and denied states.
 * Deps: React event handling only.
 * MainFuncs: PlaybackTokenAccess.
 * SideEffects: Invokes token activation/clear callbacks from props.
 */

import { useState, useEffect } from 'react';
import PlaybackAccessPanel from './PlaybackAccessPanel.jsx';

export default function PlaybackTokenAccess({
    tokenInput,
    onTokenInputChange,
    onActivate,
    onClear,
    isBusy,
    tokenStatus,
    message,
    compact = false,
}) {
    const [showAccess, setShowAccess] = useState(false);

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

    const handleSubmit = (event) => {
        event.preventDefault();
        onActivate(tokenInput);
    };
    const activeCameraCount = tokenStatus?.allowed_camera_ids?.length || tokenStatus?.camera_ids?.length || 0;
    const activeRuleWindow = tokenStatus?.effective_playback_window_hours
        || tokenStatus?.playback_window_hours
        || tokenStatus?.camera_rules?.find((rule) => rule?.playback_window_hours)?.playback_window_hours
        || null;

    return (
        <form
            onSubmit={handleSubmit}
            className={`rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${compact ? 'w-full' : ''}`}
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Token Playback
                    </label>
                    <input
                        type="password"
                        value={tokenInput}
                        onChange={(event) => onTokenInputChange(event.target.value)}
                        placeholder="Masukkan token akses"
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                    />
                    {/*
                     * The one moment a visitor is being asked for something they may not have, so the
                     * way to get one belongs here — expanded in place, never linking away: a separate
                     * page stripped the app shell AND navigated them off the player they were trying
                     * to unlock. Semantic tokens on purpose; the gray-* classes around this are
                     * deprecated legacy, not a pattern to copy.
                     *
                     * onIssued closes the loop: the key we just minted goes straight into the input
                     * and activates, so the visitor never has to read and retype what the app
                     * already knows. It stays on screen only because it is worth copying elsewhere.
                     */}
                    {!tokenStatus && (
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
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Aktifkan
                    </button>
                    {tokenStatus && (
                        <button
                            type="button"
                            onClick={onClear}
                            disabled={isBusy}
                            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-200 disabled:opacity-60 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            Hapus
                        </button>
                    )}
                </div>
            </div>
            {(message || tokenStatus) && (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                    {/*
                      * The suffixes describe an ACTIVE token, so they may only follow the active
                      * message. Appending them to an error produced sentences like "Token playback
                      * tidak valid tanpa tanggal kedaluwarsa - Akses: 14 kamera", which reads as a
                      * bizarre reason for the failure rather than as two unrelated facts.
                      */}
                    {message || 'Token aktif'}
                    {!message && tokenStatus && (
                        <>
                            {tokenStatus.expires_at ? ` sampai ${tokenStatus.expires_at}` : ' tanpa tanggal kedaluwarsa'}
                            {activeCameraCount > 0 ? ` - Akses: ${activeCameraCount} kamera` : ''}
                            {activeRuleWindow ? ` - Window: ${activeRuleWindow} jam terakhir` : ''}
                        </>
                    )}
                </div>
            )}
        </form>
    );
}
