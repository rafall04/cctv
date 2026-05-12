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

    return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/40">
            <div className="mb-3 text-sm font-semibold text-emerald-900 dark:text-emerald-100">Token baru dibuat</div>
            <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-gray-800 dark:bg-gray-950 dark:text-gray-100">{createdShare.shareText}</pre>
            <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => onCopy(createdShare.shareText)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-gray-900">Copy Teks</button>
                <button onClick={onNativeShare} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-800 dark:bg-gray-800 dark:text-gray-100">Share</button>
                <a href={whatsappHref} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">WhatsApp</a>
            </div>
        </div>
    );
}
