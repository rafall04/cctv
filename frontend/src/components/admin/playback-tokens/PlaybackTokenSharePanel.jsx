/*
 * Purpose: Render generated playback token share text and outbound share actions.
 * Caller: PlaybackTokenManagement page.
 * Deps: React props only.
 * MainFuncs: PlaybackTokenSharePanel.
 * SideEffects: Invokes copy/native share callbacks supplied by page hook.
 */

export default function PlaybackTokenSharePanel({ createdShare, whatsappHref, onCopy, onNativeShare }) {
    if (!createdShare) {
        return null;
    }

    const shareText = String(createdShare.shareText || '').trim();
    const hasShareText = shareText.length > 0;
    const disabledButtonClass = 'disabled:cursor-not-allowed disabled:opacity-50';

    return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/40">
            <div className="mb-3 text-sm font-semibold text-emerald-900 dark:text-emerald-100">Token baru dibuat</div>
            <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-gray-800 dark:bg-gray-950 dark:text-gray-100">{shareText}</pre>
            <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={!hasShareText} onClick={() => onCopy(shareText)} className={`rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-gray-900 ${disabledButtonClass}`}>Copy Teks</button>
                <button type="button" disabled={!hasShareText} onClick={() => onNativeShare(shareText)} className={`rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-800 dark:bg-gray-800 dark:text-gray-100 ${disabledButtonClass}`}>Share</button>
                <a
                    href={hasShareText ? whatsappHref : '#'}
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={hasShareText ? 'false' : 'true'}
                    tabIndex={hasShareText ? 0 : -1}
                    onClick={(event) => {
                        if (!hasShareText) {
                            event.preventDefault();
                        }
                    }}
                    className={`rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 ${hasShareText ? '' : 'pointer-events-none opacity-50'}`}
                >
                    WhatsApp
                </a>
            </div>
        </div>
    );
}
