const MODES = [
    {
        value: 'full',
        label: 'Full',
    },
    {
        value: 'simple',
        label: 'Simple',
    },
];

export default function LayoutModeToggle({ layoutMode, onChange, compact = false }) {
    return (
        <div
            className={`inline-grid grid-cols-2 rounded-2xl border border-white/70 bg-white/85 p-1 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-gray-200/70 backdrop-blur dark:border-gray-700/80 dark:bg-gray-900/80 dark:ring-gray-700/70 ${
                compact ? 'min-w-[126px]' : 'min-w-[144px]'
            }`}
            role="tablist"
            aria-label="Pilih mode tampilan"
        >
            {MODES.map((mode) => {
                const isActive = layoutMode === mode.value;

                return (
                    <button
                        key={mode.value}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => {
                            if (!isActive) {
                                onChange(mode.value);
                            }
                        }}
                        className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold tracking-[0.02em] transition-all duration-200 ${
                            isActive
                                ? 'bg-gradient-to-r from-primary to-primary-600 text-white shadow-[0_10px_24px_rgba(14,165,233,0.28)]'
                                : 'text-gray-600 hover:bg-gray-100/90 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/80 dark:hover:text-white'
                        }`}
                    >
                        <span>{mode.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
