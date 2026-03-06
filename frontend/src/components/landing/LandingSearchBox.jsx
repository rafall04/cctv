import { Icons } from '../ui/Icons';

export default function LandingSearchBox({
    searchQuery,
    onSearchChange,
    onFocus,
    onClear,
    searchInputRef,
    searchContainerRef,
    showSearchDropdown,
    dropdownContent,
}) {
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
                    className="w-full pl-10 pr-20 sm:pr-24 py-2.5 sm:py-3 bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-primary dark:focus:border-primary rounded-xl text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm sm:text-base outline-none transition-colors"
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
