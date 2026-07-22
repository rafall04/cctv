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
    // Was the single loudest "AI template" tell in the header: a glass panel
    // (bg-white/85 + backdrop-blur + arbitrary 30px shadow + gray ring) wrapping a
    // gradient pill with its own coloured glow. Now a plain segmented control on
    // the token surface — the active segment is flat primary, nothing glows.
    return (
        <div
            className={`inline-grid grid-cols-2 gap-0.5 rounded-control border border-edge bg-surface-sunken p-0.5 ${
                compact ? 'min-w-[120px]' : 'min-w-[140px]'
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
                        className={`inline-flex items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] px-3 py-1.5 text-xs font-medium transition-colors ${
                            isActive
                                ? 'bg-primary text-white'
                                : 'text-content-muted hover:bg-surface-raised hover:text-content'
                        }`}
                    >
                        <span>{mode.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
