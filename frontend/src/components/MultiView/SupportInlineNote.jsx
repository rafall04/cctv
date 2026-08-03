/*
 * Purpose: Ask for support at the one moment it is earned — under a stream the visitor has just
 *          watched — as a single quiet line that never interrupts anything.
 * Caller: CameraDetailPanel (inside the public video popup).
 * Deps: React hooks, /api/saweria/config, saweriaConfig cache.
 * MainFuncs: SupportInlineNote.
 * SideEffects: Reads the shared Saweria config (one fetch per page load), opens an external tab.
 *
 * Why a line and not a card: it sits directly beneath "Bagikan / Tambah favorit / Buka area",
 * which are outline buttons. A filled amber block there would outrank the actions the visitor
 * actually came for. Subordinate styling is the whole point — the ask is present, not competing.
 *
 * Deliberately NOT gated on `saweria_dont_show`. That key records "stop interrupting me", which
 * is what the banner and the modal do; it was written by a button that, in the older code, only
 * ever silenced the modal and let the banner return two seconds later. Applying it here would
 * retroactively read a decision about POPUPS as a decision about page content, and would hide
 * this line forever from every visitor who ever dismissed one. The operator's `enabled` flag is
 * the only switch that governs it.
 */

import { useEffect, useState } from 'react';
import { isSaweriaEnabled, SAWERIA_URL } from '../../utils/saweriaConfig';

export default function SupportInlineNote() {
    const [enabled, setEnabled] = useState(false);

    useEffect(() => {
        let alive = true;
        isSaweriaEnabled().then((on) => {
            if (!alive) return;
            setEnabled(on);
        });
        return () => { alive = false; };
    }, []);

    if (!enabled) return null;

    return (
        <div className="mt-2.5 flex items-center gap-2 border-t border-edge pt-2.5 text-xs text-content-muted">
            <svg
                className="h-4 w-4 shrink-0 text-amber-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M18 8h1a4 4 0 010 8h-1" />
                <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
            </svg>
            <span className="min-w-0">
                Siaran ini gratis untuk semua.{' '}
                <a
                    href={SAWERIA_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-amber-600 underline-offset-2 hover:underline dark:text-amber-400"
                >
                    Traktir kopi
                </a>{' '}
                kalau berkenan.
            </span>
        </div>
    );
}
