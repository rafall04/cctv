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
                <div className="absolute left-3 text-gray-400 dark:text-gray-500 pointer-events-none">
                    <Icons.Search />
                </div>
                <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(event) => onSearchChange(event.target.value)}
                    onFocus={onFocus}
                    placeholder="Cari kamera berdasarkan nama, lokasi, atau area..."
                    className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-10 pr-20 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 sm:pr-24 sm:text-base"
                />
                <div className="absolute right-2 flex items-center gap-1.5">
                    {searchQuery && (
                        <button
                            onClick={onClear}
                            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            title="Hapus pencarian (Esc)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                    <span className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 rounded">
                        <kbd className="font-sans">Ctrl</kbd>
                        <kbd className="font-sans">K</kbd>
                    </span>
                </div>
            </div>

            {showSearchDropdown && dropdownContent}
        </div>
    );
}
