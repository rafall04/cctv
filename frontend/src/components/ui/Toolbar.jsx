/*
 * Purpose: The filter/search strip that sits between a page header and its list.
 * Caller: admin list pages (via components/ui barrel).
 * Deps: React, ./Field.
 * MainFuncs: Toolbar, SearchInput.
 * SideEffects: None.
 *
 * Why this exists: every list page invented its own toolbar row, so search width, control height
 * and wrap behaviour differed page to page. The wrap rules matter on Android: a flex row of
 * controls that cannot shrink pushes past the viewport once system font scaling is turned up, which
 * is the failure mode the mobile guardrails were written for — hence min-w-0 on the growing child.
 */

import { inputClasses } from './Field';

/**
 * @param {React.ReactNode} [children] filter controls, laid out after the search box
 * @param {React.ReactNode} [actions] right-aligned actions (bulk operations, export)
 */
export function Toolbar({ children, actions = null, className = '' }) {
    return (
        <div className={`flex flex-wrap items-center gap-2 ${className}`}>
            {children}
            {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

function SearchIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>
    );
}

/**
 * Search box with a real accessible name. `label` is visually hidden by default because the
 * magnifier plus placeholder carry the meaning visually — but AT still needs the name.
 */
export function SearchInput({ label = 'Cari', value, onChange, placeholder = 'Cari…', className = '', ...rest }) {
    return (
        <div className={`relative min-w-0 flex-1 sm:max-w-xs ${className}`}>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle">
                <SearchIcon />
            </span>
            <input
                type="search"
                aria-label={label}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                className={inputClasses({ className: 'pl-9' })}
                {...rest}
            />
        </div>
    );
}
