/*
 * Purpose: Render the public landing view-mode switch (Peta / Grid / Playback).
 * Caller: Public landing camera workspace.
 * Deps: ui/Icons for the per-mode glyphs.
 * MainFuncs: LandingViewModeSwitch.
 * SideEffects: Invokes the caller-provided change handler.
 */

import { Icons } from '../ui/Icons';

export default function LandingViewModeSwitch({ viewMode, onChange }) {
    const buttons = [
        { key: 'map', label: 'Peta', title: 'Map View', icon: <Icons.Map /> },
        { key: 'grid', label: 'Grid', title: 'Grid View (Multi-View)', icon: <Icons.Grid /> },
        { key: 'playback', label: 'Playback', title: 'Playback Rekaman', icon: <Icons.Clock /> },
    ];

    /*
     * This row is the reason the page could scroll sideways on phones. Three
     * fixed-padding buttons sat in a flex row with nothing allowed to shrink, so
     * their width was driven purely by the rendered text. At Android's larger
     * font-scale settings the labels grow, the row grows past the viewport, and a
     * page that overflows horizontally gets zoomed out by the browser — which is
     * how one control ends up shrinking the whole screen.
     *
     * `max-w-full` caps the row, `min-w-0` lets each button shrink below its
     * content, and `truncate` gives the label somewhere to go. The icons stay
     * `shrink-0` so a mode is always identifiable even if its word is clipped.
     */
    return (
        <div className="flex max-w-full items-center gap-1 rounded-control border border-edge bg-surface p-1">
            {buttons.map((button) => (
                <button
                    key={button.key}
                    onClick={() => onChange(button.key)}
                    className={`flex min-w-0 items-center justify-center gap-1.5 rounded-control px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
                        viewMode === button.key
                            ? 'bg-primary text-white'
                            : 'text-content-muted hover:bg-surface-raised hover:text-content'
                    }`}
                    title={button.title}
                >
                    <span className="shrink-0">{button.icon}</span>
                    <span className="truncate">{button.label}</span>
                </button>
            ))}
        </div>
    );
}
