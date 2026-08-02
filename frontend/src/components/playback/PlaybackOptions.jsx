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

import usePlaybackAccessOffer from '../../hooks/playback/usePlaybackAccessOffer';

export default function PlaybackOptions({
    playbackPolicy = null,
    showPublicNotice = false,
    autoPlayEnabled,
    onAutoPlayToggle,
}) {
    /** The notice still explains the limit when nothing is on sale; only the sales pitch goes. */
    const { offered: accessOffered } = usePlaybackAccessOffer();

    return (
        <div className="space-y-3 rounded-card border border-edge bg-surface p-3 sm:p-4">
            {/*
              * The accessMode check stops the two panels contradicting each other. A token holder
              * was shown "Akses Playback Publik Terbatas — Preview 10 Menit — Coba gratis 3 hari"
              * directly above "Akses playback aktif — 4 jam terakhir", because the notice only ever
              * asked whether it was ENABLED, never whether this visitor had already got past it.
              */}
            {showPublicNotice && playbackPolicy?.notice?.enabled && playbackPolicy.accessMode !== 'token_full' && (
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
                     * The only next step offered. The admin-contact button was removed deliberately:
                     * self-serve exists, so sending people to chat an operator adds a manual step
                     * that scales badly and leaves the visitor waiting.
                     *
                     * An event, not an <a href="#...">. The anchor only scrolled to the access box
                     * while it was still COLLAPSED, so the visitor landed in the right place and saw
                     * nothing happen. The intent here is "open the access panel", and a hash cannot
                     * express that — nor re-fire when the hash is already set.
                     *
                     * Hidden entirely when no package is enabled: the panel it opens would be empty,
                     * and the button names a free trial that the server would refuse.
                     */}
                    {accessOffered && (
                        <button
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('playback:open-access'))}
                            className="mt-2 inline-flex items-center gap-2 rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-white"
                        >
                            Coba gratis 3 hari atau beli akses
                        </button>
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
