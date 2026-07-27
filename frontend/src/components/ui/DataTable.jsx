/*
 * Purpose: Table primitives for admin lists — scroll containment, sticky head, sortable headers
 *   with aria-sort, and a consistent dense row rhythm.
 * Caller: admin pages/components (via components/ui barrel).
 * Deps: React only.
 * MainFuncs: TableShell, Table, THead, TBody, TR, TH, TD, SortableTH.
 * SideEffects: None.
 *
 * Why this exists: 22 admin files render a <table>, each re-deciding header colour, row divider,
 * cell padding and whether the table may scroll. Sorting was styled but never announced — the
 * audit found zero aria-sort in admin. TableShell also owns the horizontal scroll so a wide table
 * can never widen the page itself (the mobile zoom-out failure mode this repo has already shipped
 * a guard for).
 */

/**
 * Scroll container for a table. Keep the overflow HERE, never on an ancestor of the whole page.
 */
export function TableShell({ className = '', children }) {
    return (
        <div className={`overflow-x-auto rounded-card border border-edge bg-surface ${className}`}>
            {children}
        </div>
    );
}

export function Table({ className = '', children, ...rest }) {
    return (
        <table className={`w-full min-w-full border-collapse text-left text-sm ${className}`} {...rest}>
            {children}
        </table>
    );
}

export function THead({ className = '', children }) {
    return (
        <thead className={`bg-surface-sunken text-xs uppercase tracking-wide text-content-subtle ${className}`}>
            {children}
        </thead>
    );
}

export function TBody({ className = '', children }) {
    return <tbody className={`divide-y divide-edge ${className}`}>{children}</tbody>;
}

export function TR({ interactive = false, className = '', children, ...rest }) {
    return (
        <tr className={`${interactive ? 'transition-colors hover:bg-surface-raised' : ''} ${className}`} {...rest}>
            {children}
        </tr>
    );
}

export function TH({ align = 'left', className = '', children, ...rest }) {
    return (
        <th
            scope="col"
            className={`whitespace-nowrap px-3 py-2.5 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
            {...rest}
        >
            {children}
        </th>
    );
}

/**
 * Numeric cells opt into `mono` so digits line up column-wise and do not reflow when a value
 * changes width mid-poll.
 */
export function TD({ align = 'left', mono = false, className = '', children, ...rest }) {
    return (
        <td
            className={`px-3 py-2.5 align-middle text-content ${align === 'right' ? 'text-right' : 'text-left'} ${
                mono ? 'font-mono tabular-nums' : ''
            } ${className}`}
            {...rest}
        >
            {children}
        </td>
    );
}

const NEXT_DIRECTION = { none: 'asc', asc: 'desc', desc: 'asc' };
const ARIA_SORT = { asc: 'ascending', desc: 'descending', none: 'none' };

/**
 * Sortable column header. `direction` is 'asc' | 'desc' | 'none' for THIS column; the parent owns
 * which column is active. aria-sort is what actually tells a screen reader the list is ordered.
 */
export function SortableTH({ direction = 'none', onSort, align = 'left', className = '', children }) {
    return (
        <th
            scope="col"
            aria-sort={ARIA_SORT[direction] ?? 'none'}
            className={`whitespace-nowrap p-0 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
        >
            <button
                type="button"
                onClick={() => onSort?.(NEXT_DIRECTION[direction] ?? 'asc')}
                className={`flex w-full items-center gap-1 px-3 py-2.5 uppercase tracking-wide transition-colors hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                    align === 'right' ? 'justify-end' : 'justify-start'
                } ${direction === 'none' ? '' : 'text-content'}`}
            >
                <span className="min-w-0 truncate">{children}</span>
                <svg
                    className={`h-3 w-3 shrink-0 transition-transform ${direction === 'none' ? 'opacity-40' : ''} ${
                        direction === 'desc' ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
            </button>
        </th>
    );
}
