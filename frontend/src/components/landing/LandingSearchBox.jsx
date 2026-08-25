/*
 * Purpose: Render public landing camera search input, dropdown, and keyboard shortcuts.
 * Caller: LandingCamerasSection.
 * Deps: React effect cleanup and landing UI icons.
 * MainFuncs: LandingSearchBox.
 * SideEffects: Focuses search input on Ctrl/Cmd+K and closes dropdown on Escape/outside click.
 */

import { useEffect } from 'react';
import { Icons } from '../ui/Icons';

export default function LandingSearchBox({
    searchQuery,
    onSearchChange,
    onFocus,
    onClear,
    onCloseDropdown,
    searchInputRef,
    searchContainerRef,
    showSearchDropdown,
    dropdownContent,
}) {
    useEffect(() => {
        const handleKeyDown = (event) => {
            const isSearchShortcut = event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey);
            if (isSearchShortcut) {
                event.preventDefault();
                searchInputRef?.current?.focus();
                return;
            }

            if (event.key === 'Escape') {
                if (searchQuery) {
                    onClear?.();
                }
                onCloseDropdown?.();
            }
        };

        const handleMouseDown = (event) => {
            if (!showSearchDropdown) {
                return;
            }
            if (searchContainerRef?.current?.contains(event.target)) {
                return;
            }
            onCloseDropdown?.();
        };

        window.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleMouseDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, [onClear, onCloseDropdown, searchContainerRef, searchInputRef, searchQuery, showSearchDropdown]);

    return (
        <div className="relative" ref={searchContainerRef}>
            <div className="relative flex items-center">
                <div className="absolute left-3 text-content-subtle pointer-events-none">
                    <Icons.Search />
                </div>
                <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(event) => onSearchChange(event.target.value)}
                    onFocus={onFocus}
                    placeholder="Cari kamera berdasarkan nama, lokasi, atau area..."
                    /* text-base sm:text-sm, never the reverse: Safari iOS zooms the whole page in
                       when a focused input is under 16px, and this is the most-tapped control here. */
                    className="w-full rounded-control border border-edge bg-surface py-3 pl-10 pr-20 text-base text-content outline-none transition-colors placeholder:text-content-subtle focus:border-primary focus:ring-4 focus:ring-primary/10 sm:pr-24 sm:text-sm"
                />
                <div className="absolute right-2 flex items-center gap-1.5">
                    {searchQuery && (
                        <button
                            onClick={onClear}
                            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-control p-1.5 text-content-subtle transition-colors hover:bg-surface-raised hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-0 sm:min-w-0"
                            aria-label="Hapus pencarian"
                            title="Hapus pencarian (Esc)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                    <span className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-content-subtle bg-surface-raised rounded">
                        <kbd className="font-sans">Ctrl</kbd>
                        <kbd className="font-sans">K</kbd>
                    </span>
                </div>
            </div>

            {showSearchDropdown && dropdownContent}
        </div>
    );
}
