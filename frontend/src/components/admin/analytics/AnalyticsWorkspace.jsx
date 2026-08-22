/*
 * Purpose: Header block shared by the two analytics workspaces — the shared PageHeader plus the
 *          last-update stamp and the caller's filter row.
 * Caller: pages/ViewerAnalytics.jsx, pages/PlaybackAnalytics.jsx.
 * Deps: components/ui/PageHeader.
 * MainFuncs: AnalyticsWorkspaceHeader.
 * SideEffects: None.
 *
 * AnalyticsTabNav used to live here: a row of plain <button>s in a rounded box — no role="tab", no
 * aria-selected, no arrow keys. It was deleted rather than rewritten. Its only remaining job would
 * have been renaming `activeTab` to `activeId` on the way into components/ui/Tabs, and that
 * indirection is exactly what let two pages drift away from the primitive in the first place. Both
 * consumers now call <Tabs> directly.
 *
 * The title block is NOT the same case, which is why this component survives where the tab nav did
 * not: it is not a rename in front of PageHeader, it carries layout the two pages genuinely share —
 * the `space-y-4` between header and filters, the filters slot itself, and one spelling of the
 * "Update terakhir" stamp. The h1 now comes from the primitive, so the drift the ratchet in
 * components/ui/PageHeader.test.jsx guards against cannot re-enter through here.
 *
 * ViewerAnalyticsHeader.jsx was deleted alongside this change. It rendered a SECOND header for this
 * very page — eyebrow, h1, description, period picker — and had had zero importers since before
 * f31879b; ViewerAnalytics.jsx has called AnalyticsWorkspaceHeader all along. Migrating a dead
 * duplicate onto the primitive would have preserved exactly the thing the primitive exists to end.
 */

import { PageHeader } from '../../ui/PageHeader';

export function AnalyticsWorkspaceHeader({ title, description, lastUpdate, filters }) {
    return (
        <div className="space-y-4">
            <PageHeader
                title={title}
                description={description}
                // `meta`, not `actions`: the stamp is a status chip about the page, not something
                // to click. It used to sit right-aligned opposite the title, where at 320px it
                // competed with a title it is subordinate to.
                meta={(
                    <span className="text-xs text-content-muted">
                        Update terakhir: {lastUpdate ? lastUpdate.toLocaleTimeString('id-ID') : '-'}
                    </span>
                )}
            />
            {filters}
        </div>
    );
}

export default AnalyticsWorkspaceHeader;
