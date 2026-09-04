/*
 * Purpose: "Tonton Live" affordance for a token holder on the public playback page — owns the modal
 *          open state and renders TokenLivePlayer, so the Playback page carries neither.
 * Caller: pages/Playback.jsx.
 * Deps: TokenLivePlayer.
 * MainFuncs: TokenLiveButton.
 *
 * `enabled` is the token-level allow_live from activation; the backend re-checks per-camera on the
 * grant, so a per-camera denial still fails closed even if this button shows.
 */

import { useState } from 'react';
import TokenLivePlayer from './TokenLivePlayer.jsx';

export default function TokenLiveButton({ camera, enabled }) {
    const [open, setOpen] = useState(false);
    if (!enabled || !camera) {
        return null;
    }
    return (
        <>
            {open && <TokenLivePlayer camera={camera} onClose={() => setOpen(false)} />}
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="inline-flex items-center gap-2 rounded-control bg-status-live/15 px-3 py-1.5 text-sm font-medium text-status-live transition-colors hover:bg-status-live/25"
                >
                    <span className="h-2 w-2 rounded-full bg-status-live" />
                    Tonton Live
                </button>
            </div>
        </>
    );
}
