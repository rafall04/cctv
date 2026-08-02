/*
 * Purpose: Share the current playback link.
 * Caller: Playback page (public scope only).
 * Deps: Caller-provided share handler.
 * MainFuncs: PlaybackShareButton.
 * SideEffects: Invokes the caller's share handler.
 *
 * Extracted from Playback.jsx, which sits at its size ceiling: the rule is to extract rather than
 * grow, and fourteen lines of inline markup for one button was the cheapest thing to lift out.
 */

export default function PlaybackShareButton({ onShare }) {
    return (
        <div className="flex justify-center">
            <button
                onClick={onShare}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-content bg-surface-raised border border-edge hover:bg-surface-overlay rounded-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                title="Bagikan tautan playback ini"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Bagikan Link Playback
            </button>
        </div>
    );
}
