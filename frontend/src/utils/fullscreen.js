/*
 * Purpose: Enter or leave fullscreen on an element without every caller re-implementing the
 *          vendor-optional dance and the rejection handling.
 * Caller: pages/Playback.jsx (and available to the other players, which each carry their own copy).
 * Deps: none.
 * MainFuncs: toggleElementFullscreen.
 * SideEffects: Changes the document's fullscreen element.
 *
 * `requestFullscreen` REJECTS rather than throwing synchronously — a rejection nobody catches
 * surfaces as an unhandled promise rejection, which on this project is what pm2 restarts on.
 */

export async function toggleElementFullscreen(element) {
    try {
        if (!document.fullscreenElement) {
            await element?.requestFullscreen?.();
            return true;
        }
        await document.exitFullscreen?.();
        return false;
    } catch (err) {
        console.error('Fullscreen error:', err);
        return Boolean(document.fullscreenElement);
    }
}

export default toggleElementFullscreen;
