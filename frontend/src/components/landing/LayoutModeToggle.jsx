import { Icons } from '../ui/Icons';

const MODES = [
    {
        value: 'full',
        label: 'Full',
        icon: Icons.Layout,
    },
    {
        value: 'simple',
        label: 'Simple',
        icon: Icons.Grid,
    },
];

export default function LayoutModeToggle({ layoutMode, onChange, compact = false }) {
    return (
        <div
            className={`inline-grid grid-cols-2 rounded-2xl border border-white/70 bg-white/85 p-1 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-gray-200/70 backdrop-blur dark:border-gray-700/80 dark:bg-gray-900/80 dark:ring-gray-700/70 ${
                compact ? 'min-w-[168px]' : 'min-w-[188px]'
            }`}
            role="tablist"
            aria-label="Pilih mode tampilan"
        >
            {MODES.map((mode) => {
                const Icon = mode.icon;
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
                        className={`group inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 ${
                            isActive
                                ? 'bg-gradient-to-r from-primary to-primary-600 text-white shadow-[0_10px_24px_rgba(14,165,233,0.28)]'
                                : 'text-gray-600 hover:bg-gray-100/90 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/80 dark:hover:text-white'
                        }`}
                    >
                        <span
                            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                                isActive
                                    ? 'bg-white/18 text-white'
                                    : 'bg-gray-100 text-gray-500 group-hover:bg-white group-hover:text-primary dark:bg-gray-800 dark:text-gray-400 dark:group-hover:bg-gray-700'
                            }`}
                        >
                            <Icon />
                        </span>
                        <span className="tracking-[0.02em]">{mode.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
