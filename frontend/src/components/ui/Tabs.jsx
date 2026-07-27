/*
 * Purpose: Accessible tab strip — roles, aria-selected, roving tabindex and arrow-key traversal.
 * Caller: admin pages that switch panels in place (Settings, Analytics, Billing).
 * Deps: React only.
 * MainFuncs: Tabs, TabPanel.
 * SideEffects: Moves focus between tabs on arrow/Home/End keys.
 *
 * Why this exists: every admin tab strip was a row of plain buttons — zero role="tab" and zero
 * aria-selected across the whole admin surface, so a screen reader announced "9 buttons" with no
 * indication which panel was showing. The active tab also hardcoded sky-500, which meant the one
 * colour an operator can rebrand at runtime did not apply here.
 */

import { useRef } from 'react';

/**
 * @param {Array<{id: string, label: string, icon?: React.ReactNode, badge?: React.ReactNode}>} tabs
 * @param {string} activeId
 * @param {(id: string) => void} onChange
 * @param {string} idPrefix stable prefix so tab/panel ids pair up across renders
 */
export function Tabs({ tabs, activeId, onChange, idPrefix = 'tab', className = '' }) {
    const listRef = useRef(null);

    const handleKeyDown = (event) => {
        const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();

        const index = tabs.findIndex((t) => t.id === activeId);
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;

        const target = tabs[next];
        if (!target) return;
        onChange(target.id);
        // Follow focus so the keyboard user lands on the tab they just selected. Index into the
        // rendered tabs rather than building an id selector — tab ids are caller-supplied strings
        // and would need CSS.escape to be query-safe.
        listRef.current?.querySelectorAll('[role="tab"]')[next]?.focus();
    };

    return (
        <div className={`border-b border-edge ${className}`}>
            <div
                ref={listRef}
                role="tablist"
                onKeyDown={handleKeyDown}
                className="-mb-px flex gap-1 overflow-x-auto no-scrollbar"
            >
                {tabs.map((tab) => {
                    const selected = tab.id === activeId;
                    return (
                        <button
                            key={tab.id}
                            id={`${idPrefix}-${tab.id}`}
                            role="tab"
                            type="button"
                            aria-selected={selected}
                            aria-controls={`${idPrefix}panel-${tab.id}`}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => onChange(tab.id)}
                            className={`flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                                selected
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-content-muted hover:border-edge-strong hover:text-content'
                            }`}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                            {tab.badge}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** Panel half of the pair. Rendered only when active, so a hidden panel costs nothing. */
export function TabPanel({ id, idPrefix = 'tab', className = '', children }) {
    return (
        <div
            role="tabpanel"
            id={`${idPrefix}panel-${id}`}
            aria-labelledby={`${idPrefix}-${id}`}
            tabIndex={0}
            className={`focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
        >
            {children}
        </div>
    );
}
