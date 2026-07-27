/*
 * Purpose: The one card/panel shell for admin surfaces.
 * Caller: admin pages/components (via components/ui barrel).
 * Deps: React only.
 * MainFuncs: Card, CardHeader, CardBody, CardFooter, CardTitle.
 * SideEffects: None.
 *
 * Why this exists: the audit found 20+ near-identical card class strings across admin — five
 * different dark card surfaces (gray-800, 800/50, 800/90, 900, 900/50), four border weights and
 * three radii, all meaning "a panel". One shell, one radius, one edge.
 */

const PADDING = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-5',
};

/**
 * @param {'none'|'sm'|'md'|'lg'} [padding='md']
 * @param {boolean} [raised] use the hover/nested surface step instead of the base card surface
 * @param {boolean} [interactive] adds hover affordance; pair with a real button/link wrapper
 */
export function Card({ padding = 'md', raised = false, interactive = false, className = '', children, ...rest }) {
    return (
        <div
            className={`rounded-card border border-edge ${raised ? 'bg-surface-raised' : 'bg-surface'} ${PADDING[padding] ?? PADDING.md} ${
                interactive ? 'transition-colors hover:border-edge-strong hover:bg-surface-raised' : ''
            } ${className}`}
            {...rest}
        >
            {children}
        </div>
    );
}

/** Header row inside a Card: title/description on the left, actions on the right. */
export function CardHeader({ title, description, actions = null, className = '', children }) {
    return (
        <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
            <div className="min-w-0 flex-1">
                {title && <CardTitle>{title}</CardTitle>}
                {description && <p className="mt-1 text-xs text-content-muted">{description}</p>}
                {children}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

export function CardTitle({ as: Tag = 'h2', className = '', children }) {
    return <Tag className={`text-sm font-semibold text-content ${className}`}>{children}</Tag>;
}

export function CardBody({ className = '', children }) {
    return <div className={`mt-4 ${className}`}>{children}</div>;
}

/** Footer actions; the top edge keeps the separation without a second shadow step. */
export function CardFooter({ className = '', children }) {
    return (
        <div className={`mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-edge pt-4 ${className}`}>
            {children}
        </div>
    );
}
