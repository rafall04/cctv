/*
 * Purpose: Pick-one-of-N segmented control — the equal-width button row every admin form was
 *   hand-rolling (source pickers, target pickers, kind toggles). One primitive so the option
 *   styling, focus ring, and keyboard traversal stop being per-author decisions.
 * Caller: admin pages/components (via components/ui barrel).
 * Deps: React only.
 * MainFuncs: SegmentedControl.
 * SideEffects: Moves focus between options on arrow keys (roving tabindex, like Tabs).
 *
 * Semantics: this is a radiogroup, not a tablist — it picks a VALUE (the panel does not swap,
 * only the field's contents), so role="radio" + aria-checked is the honest pattern and keeps
 * the whole group inside the tab order exactly once.
 */

import { useId, useRef } from 'react';

/**
 * @param {string} label visible group label, always rendered (never placeholder-only)
 * @param {Array<{value: string, label: React.ReactNode, disabled?: boolean, hint?: string}>} options
 * @param {string} value current value
 * @param {(value: string) => void} onChange
 * @param {string} [hint] persistent helper text under the group
 * @param {boolean} [disabled] disable the whole group
 */
export function SegmentedControl({ label, options, value, onChange, hint, disabled = false, className = '' }) {
    const generatedId = useId();
    const listRef = useRef(null);
    const enabled = options.filter((o) => !o.disabled);
    const index = Math.max(0, options.findIndex((o) => o.value === value && !o.disabled));

    const move = (event) => {
        const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % options.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = options.length - 1;
        // Skip disabled options — keep stepping in the same direction (End steps BACKWARD so a
        // disabled last option lands on the last ENABLED one, not on the first).
        const dir = (event.key === 'ArrowLeft' || event.key === 'End') ? -1 : 1;
        for (let i = 0; i < options.length; i += 1) {
            if (!options[next]?.disabled) break;
            next = (next + dir + options.length) % options.length;
        }
        const target = options[next];
        if (!target || target.disabled) return;
        onChange(target.value);
        listRef.current?.querySelectorAll('[role="radio"]')[next]?.focus();
    };

    return (
        <div className={`min-w-0 ${className}`.trim()}>
            <span id={generatedId} className="mb-1.5 block text-xs font-semibold text-content-muted">{label}</span>
            <div
                ref={listRef}
                role="radiogroup"
                aria-labelledby={generatedId}
                onKeyDown={move}
                className="flex gap-2"
            >
                {options.map((opt) => {
                    const selected = opt.value === value;
                    // Roving tabindex: the checked option (or the first enabled one when the
                    // value doesn't match — an uninitialised control is still reachable).
                    const focusTarget = selected && !opt.disabled ? opt : (options.every((o) => o.value !== value || o.disabled) ? enabled[0] : null);
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={disabled || opt.disabled}
                            title={opt.hint}
                            tabIndex={!disabled && opt === focusTarget ? 0 : -1}
                            onClick={() => onChange(opt.value)}
                            className={`flex-1 rounded-control border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                                selected
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-edge bg-surface text-content-muted hover:border-edge-strong'
                            }`}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
            {hint && <p className="mt-1 text-xs text-content-subtle">{hint}</p>}
        </div>
    );
}
