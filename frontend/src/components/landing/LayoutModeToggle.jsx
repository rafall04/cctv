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
            className={`inline-flex items-center rounded-xl border border-gray-200 bg-white/90 p-1 shadow-sm dark:border-gray-700 dark:bg-gray-800/90 ${
                compact ? 'gap-1' : 'gap-1.5'
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
                        className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors sm:px-3 ${
                            isActive
                                ? 'bg-primary text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                    >
                        <Icon />
                        <span>{mode.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
