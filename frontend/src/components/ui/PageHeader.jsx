/*
 * Purpose: One page-header block for every admin route — title, context line, meta and actions.
 * Caller: admin pages (via components/ui barrel).
 * Deps: React only.
 * MainFuncs: PageHeader.
 * SideEffects: None.
 *
 * Why this exists: each admin page hand-built its own header, so heading level, type size, spacing
 * and the position of the action buttons drifted page to page. A fixed h1 also gives every route a
 * correct document outline, which the audit found missing.
 */

/**
 * @param {string} title rendered as the page's single h1
 * @param {string} [description] one short line of context under the title
 * @param {React.ReactNode} [meta] inline status/timestamp chips shown beside the title
 * @param {React.ReactNode} [actions] page-level actions, right-aligned on wide screens
 */
export function PageHeader({ title, description, meta = null, actions = null, className = '' }) {
    return (
        <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`}>
            <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-content">{title}</h1>
                {description && <p className="mt-1 text-sm text-content-muted">{description}</p>}
                {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}
