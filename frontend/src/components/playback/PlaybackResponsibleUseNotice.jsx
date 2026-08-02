/*
 * Purpose: State the responsible-use rule where it cannot be missed — directly under the player.
 * Caller: Playback page, between PlaybackVideo and the segment controls.
 * Deps: None; presentational only.
 * MainFuncs: PlaybackResponsibleUseNotice.
 * SideEffects: None.
 *
 * WHY IT MOVED
 * It used to live at the foot of the usage guide, the last block on the page. A viewer who never
 * scrolled that far never read it — which is every viewer who came to watch a clip and left.
 *
 * WHY IT IS ONE LINE
 * The segment controls sit immediately below and were deliberately placed within the first screen;
 * a tall banner here would undo that. A permanent warning also has to survive being seen every
 * single visit: shout, and it becomes wallpaper. One firm sentence with a red rule reads as a rule,
 * not as decoration.
 */

export default function PlaybackResponsibleUseNotice() {
    return (
        <div
            role="note"
            className="flex items-start gap-2.5 rounded-card border border-edge border-l-2 border-l-status-fault bg-surface px-3 py-2.5 sm:px-4"
        >
            <svg
                className="mt-0.5 h-4 w-4 shrink-0 text-status-fault"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
            >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-xs leading-5 text-content sm:text-sm">
                <span className="font-semibold">Gunakan dengan bijak.</span>{' '}
                <span className="text-content-muted">
                    Rekaman ini memuat orang dan kendaraan nyata. Jangan disebarkan ulang, dipotong di luar
                    konteks, atau dipakai untuk mengganggu privasi siapa pun.
                </span>
            </p>
        </div>
    );
}
