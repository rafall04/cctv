/*
 * Purpose: Render the playback access notice and the auto-play toggle, BELOW the video.
 * Caller: Playback page.
 * Deps: Caller-provided playback policy and auto-play handler.
 * MainFuncs: PlaybackOptions.
 * SideEffects: Invokes the caller's auto-play toggle handler.
 *
 * Split out of PlaybackHeader so the camera picker sits directly above the player. Previously the
 * header carried the title, picker, a summary card, this notice AND this toggle, which pushed the
 * video below five stacked blocks — on a phone you scrolled past all of them before seeing any
 * picture, on the page whose entire job is showing a picture.
 */

import { useMemo } from 'react';
import usePlaybackAccessOffer from '../../hooks/playback/usePlaybackAccessOffer';
import { useTimezone } from '../../contexts/TimezoneContext.jsx';

const momentText = (ms, timeZone) => new Date(ms).toLocaleString('id-ID', {
    year: 'numeric', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone,
});

/**
 * Was this visitor sent to a moment they cannot actually reach?
 *
 * WHY THIS EXISTS
 * `selectInitialSegment` silently substitutes the LATEST segment when the requested `t` falls
 * outside the accessible list. Someone who follows a shared link to "2 Agu 14.30" therefore gets
 * shown live-ish footage with nothing saying so, and concludes the shared moment was nothing.
 * Silent substitution is the bug; this states what happened.
 *
 * Derived from `window.location.search` rather than `useSearchParams` on purpose: this component
 * has no other router dependency, and taking one would require every caller and test to provide a
 * Router for a single read-only lookup.
 */
function useUnreachableSharedMoment(playbackPolicy) {
    return useMemo(() => {
        if (typeof window === 'undefined') return null;

        const requested = Number.parseInt(new URLSearchParams(window.location.search).get('t'), 10);
        if (!Number.isFinite(requested)) return null;

        // A token holder's reach is enforced by the backend (an out-of-window segment 403s), so
        // only the anonymous preview is judged here — which is also the only case worth an offer.
        const previewMinutes = Number(playbackPolicy?.previewMinutes);
        if (playbackPolicy?.accessMode === 'token_full' || !previewMinutes) return null;

        return Date.now() - requested > previewMinutes * 60 * 1000
            ? { at: requested, previewMinutes }
            : null;
    }, [playbackPolicy]);
}

export default function PlaybackOptions({
    playbackPolicy = null,
    showPublicNotice = false,
    autoPlayEnabled,
    onAutoPlayToggle,
}) {
    /** The notice still explains the limit when nothing is on sale; only the sales pitch goes. */
    const { offered: accessOffered, hasPaid } = usePlaybackAccessOffer();
    const { timezone } = useTimezone();
    const unreachableMoment = useUnreachableSharedMoment(playbackPolicy);

    /*
     * Server-resolved contact path (playback_policy.contact) — present only when the operator set
     * contactMode=branding_whatsapp AND filled the branding WhatsApp number. Rendered as a quiet
     * secondary link beside the self-serve button, and still rendered when nothing is on sale:
     * for that visitor it is the only way forward at all.
     */
    const contactLink = playbackPolicy?.contact?.href ? (
        <a
            href={playbackPolicy.contact.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-control border border-edge px-3 py-1.5 text-xs font-medium text-content-muted transition-colors hover:border-edge-strong hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
        >
            {playbackPolicy.contact.label || 'Hubungi Admin'}
        </a>
    ) : null;

    return (
        <div className="space-y-3 rounded-card border border-edge bg-surface p-3 sm:p-4">
            {/*
              * Replaces the general notice rather than stacking on it: both explain the same limit
              * and offer the same button, and this one does it about the specific thing the visitor
              * came for. Two blocks saying it twice is the noise this file already fought once.
              */}
            {unreachableMoment && (
                <div className="rounded-control border border-edge border-l-2 border-l-status-warn bg-surface-raised px-4 py-3 text-sm text-content">
                    <p className="font-semibold">Momen yang dibagikan belum bisa dibuka</p>
                    <p className="mt-1 text-xs leading-5 text-content-muted sm:text-sm">
                        Tautan ini menunjuk ke {momentText(unreachableMoment.at, timezone)}, di luar preview{' '}
                        {unreachableMoment.previewMinutes} menit yang terbuka untuk umum. Yang tampil
                        sekarang rekaman terbaru, bukan momen tersebut.
                    </p>
                    {(accessOffered || contactLink) && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            {accessOffered && (
                                <button
                                    type="button"
                                    onClick={() => window.dispatchEvent(new CustomEvent('playback:open-access'))}
                                    className="inline-flex items-center gap-2 rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-white"
                                >
                                    Buka akses ke momen ini
                                </button>
                            )}
                            {contactLink}
                        </div>
                    )}
                </div>
            )}

            {/*
              * The accessMode check stops the two panels contradicting each other. A token holder
              * was shown "Akses Playback Publik Terbatas — Preview 10 Menit — Coba gratis 3 hari"
              * directly above "Akses playback aktif — 4 jam terakhir", because the notice only ever
              * asked whether it was ENABLED, never whether this visitor had already got past it.
              */}
            {showPublicNotice && !unreachableMoment && playbackPolicy?.notice?.enabled && playbackPolicy.accessMode !== 'token_full' && (
                // Genuinely a warning, so it keeps a warning colour — but as a left rule rather than
                // a filled amber slab.
                <div className="rounded-control border border-edge border-l-2 border-l-status-warn bg-surface-raised px-4 py-3 text-sm text-content">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                            {playbackPolicy.notice.title || 'Akses Playback Publik Terbatas'}
                        </span>
                        {typeof playbackPolicy.previewMinutes === 'number' && (
                            <span className="text-[11px] font-medium tabular-nums text-status-warn">
                                Preview {playbackPolicy.previewMinutes} Menit
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-content-muted sm:text-sm">
                        {playbackPolicy.notice.text}
                    </p>
                    {/*
                     * Self-serve stays the primary next step — the earlier admin-contact button was
                     * removed because pushing every visitor to chat an operator scales badly. The
                     * contact link that returns here is different: it exists only when the operator
                     * configured one (policy.contact), so it is their choice, not a default funnel.
                     *
                     * An event, not an <a href="#...">. The anchor only scrolled to the access box
                     * while it was still COLLAPSED, so the visitor landed in the right place and saw
                     * nothing happen. The intent here is "open the access panel", and a hash cannot
                     * express that — nor re-fire when the hash is already set.
                     *
                     * The offer button hides when no package is enabled: the panel it opens would be
                     * empty, and the button names a free trial that the server would refuse.
                     */}
                    {(accessOffered || contactLink) && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            {accessOffered && (
                                <button
                                    type="button"
                                    onClick={() => window.dispatchEvent(new CustomEvent('playback:open-access'))}
                                    className="inline-flex items-center gap-2 rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-white"
                                >
                                    {hasPaid ? 'Coba gratis 3 hari atau beli akses' : 'Coba gratis 3 hari'}
                                </button>
                            )}
                            {contactLink}
                        </div>
                    )}
                </div>
            )}

            {/*
              * The token's reach used to be announced here too. It now lives ONLY in
              * PlaybackTokenAccess, beside the buttons that act on that token — two panels stating
              * the same limit a screen apart is exactly the kind of noise this page did not need.
              */}

            <div className="flex items-center justify-between gap-3 rounded-control border border-edge p-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-content">Auto-play Segment Berikutnya</div>
                    <div className="text-xs text-content-muted">
                        {autoPlayEnabled
                            ? 'Video akan otomatis lanjut ke segment berikutnya'
                            : 'Video akan berhenti di akhir segment'}
                    </div>
                </div>
                <button
                    onClick={onAutoPlayToggle}
                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${autoPlayEnabled ? 'bg-primary' : 'bg-edge-strong'}`}
                    role="switch"
                    aria-checked={autoPlayEnabled}
                    aria-label="Toggle auto-play"
                >
                    <span
                        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white transition duration-200 ease-in-out ${autoPlayEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                </button>
            </div>
        </div>
    );
}
