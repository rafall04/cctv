/*
 * Purpose: Labelled form control for admin forms — label/input wiring, hint, error, and the one
 *   input chrome. Lighter than components/ui/FormField (which owns validation state + char count);
 *   use this for the plain admin config fields that make up most of the surface.
 * Caller: admin pages/components (via components/ui barrel).
 * Deps: React.
 * MainFuncs: Field, inputClasses.
 * SideEffects: None.
 *
 * Why this exists: admin has 317 form controls but only 101 htmlFor and 31 ids — most labels were
 * floating text with no programmatic link to their input, so clicking a label did nothing and a
 * screen reader read the control unnamed. Every field here generates and wires its own id.
 * The old shared input string also ended in `focus:outline-none focus:border-primary-500`: it
 * REMOVED the focus ring and left a 1px border tint as the only keyboard affordance.
 */

import { useId } from 'react';

/** The one input chrome. Exported so a caller with a bespoke control can still match. */
export function inputClasses({ invalid = false, className = '' } = {}) {
    return `w-full min-h-11 rounded-control border bg-surface px-3 py-2 text-sm text-content placeholder:text-content-subtle transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${
        invalid ? 'border-status-fault' : 'border-edge hover:border-edge-strong'
    } ${className}`;
}

/**
 * @param {string} label visible label, always rendered (never placeholder-only)
 * @param {'input'|'select'|'textarea'} [as='input']
 * @param {string} [error] message shown under the field; also sets aria-invalid
 * @param {string} [hint] persistent helper text (not a placeholder)
 * @param {React.ReactNode} [children] <option> list when as="select"
 */
export function Field({
    label,
    as = 'input',
    error,
    hint,
    required = false,
    id: providedId,
    className = '',
    fieldClassName = '',
    children,
    ...control
}) {
    const generatedId = useId();
    const id = providedId || generatedId;
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

    const shared = {
        id,
        required,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        className: inputClasses({ invalid: Boolean(error), className: fieldClassName }),
        ...control,
    };

    return (
        <div className={className}>
            {/*
              * The required marker sits OUTSIDE <label>. Inside, it becomes part of the label's
              * text content, so the control's accessible name turns into "Nama pengguna *" —
              * `aria-hidden` does not strip it from a label association. Requiredness is already
              * carried to assistive tech by the `required` attribute on the control itself.
              */}
            <span className="mb-1.5 flex items-baseline gap-0.5">
                <label htmlFor={id} className="text-xs font-semibold text-content-muted">{label}</label>
                {required && <span className="text-status-fault" aria-hidden="true">*</span>}
            </span>

            {as === 'select' && <select {...shared}>{children}</select>}
            {as === 'textarea' && <textarea {...shared} />}
            {as === 'input' && <input {...shared} />}

            {hint && !error && <p id={hintId} className="mt-1 text-xs text-content-subtle">{hint}</p>}
            {error && (
                <p id={errorId} role="alert" className="mt-1 text-xs font-medium text-status-fault">
                    {error}
                </p>
            )}
        </div>
    );
}
