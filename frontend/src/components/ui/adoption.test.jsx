/**
 * Purpose: Hold the admin surface on its shared primitives — Tabs and TableShell — now that the
 *          2026-08-22 chrome migration moved it there.
 * Caller: Vitest frontend suite.
 * Deps: fs/path only. No rendering; these are structural rules about the tree.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The pattern this surface keeps demonstrating: where a convention is enforced by a PROVIDER or a
 * TEST it is universal — zero `window.confirm` in the whole tree, one toast store for all of admin,
 * 19 of 20 raw tables correctly wrapped against mobile overflow. Where it is enforced only by a
 * comment in a barrel file it is a coin flip: before this migration, 10 of 30 pages used PageHeader,
 * 2 of 5 tab strips used Tabs, and 2 of 20 table sites used TableShell.
 *
 * PageHeader got its guard in the same change that migrated it. These two did not, which would have
 * left two thirds of the work resting on nothing but a comment — the exact arrangement that produced
 * the drift in the first place. So they get one here.
 *
 * Neither rule is cosmetic. A hand-rolled tab strip ships no role="tab", no aria-selected and no
 * arrow-key traversal, so a screen reader announces a row of unlabelled buttons and says nothing
 * about which panel is showing. A hand-rolled table wrapper means every future fix to table chrome —
 * a sticky header, aria-sort, a density change — has to be applied in twenty places or it silently
 * applies to two.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.jsx$/.test(entry.name) && !/\.(test|spec)\.jsx$/.test(entry.name)) out.push(full);
    }
    return out;
}

const rel = (f) => path.relative(SRC_ROOT, f).split(path.sep).join('/');
const read = (r) => fs.readFileSync(path.join(SRC_ROOT, r), 'utf8');

/*
 * Comments discuss `role="tab"` constantly — several files carry a post-mortem explaining that the
 * strip used to have none. Scanning raw source would flag the explanation instead of the offence.
 */
const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('guardrail: tab strips come from components/ui/Tabs', () => {
    /*
     * A FLAT RULE, not a ratchet — all five strips moved, so there is nothing left to exempt.
     *
     * What it catches: someone re-writing a "looks correct" strip outside the primitive, which then
     * drifts again. What it deliberately does NOT catch: a hand-rolled strip that is simply WRONG
     * (plain buttons, no roles at all) — that shape is invisible to a static scan. The thing that
     * catches THAT is the ARIA contract test in pages/BillingManagement.test.jsx, which asserts the
     * roles, the roving tabindex and ArrowRight traversal on a real render. The two are a pair;
     * deleting either leaves a hole.
     *
     * SCOPED TO ADMIN on purpose. components/landing/LandingDiscoveryStrip.jsx and
     * LayoutModeToggle.jsx hand-roll a tab role on the PUBLIC surface and do it correctly — they
     * are not this migration's business, and dragging them onto an admin primitive would risk a
     * public regression to buy nothing.
     */
    it('no admin file declares a tab role of its own', () => {
        const offenders = ['pages', 'components/admin']
            .flatMap((d) => walk(path.join(SRC_ROOT, d)))
            .filter((f) => /role=("|')(tab|tablist)\1/.test(stripComments(fs.readFileSync(f, 'utf8'))))
            .map(rel);

        expect(
            offenders,
            `Tab strips must go through components/ui/Tabs: ${offenders.join(', ')}`,
        ).toEqual([]);
    });
});

/*
 * TableShell is a RATCHET, because the migration is genuinely unfinished and claiming otherwise
 * would be worse than admitting it. Fifteen files below still write their own scroll wrapper.
 *
 * THIS LIST MAY ONLY SHRINK. Do not add a file to silence a failure — use TableShell. The sibling
 * assertion below fails if an entry becomes stale, so the list cannot quietly rot into an
 * ever-growing exemption pile the way the gray-* baseline did (it sat at 660 for two commits while
 * the real count was 613).
 *
 * Two of the twenty sites had already copied TableShell's class string CHARACTER FOR CHARACTER —
 * `overflow-x-auto rounded-card border border-edge bg-surface` — and then used <Table>/<THead>
 * inside it. They adopted the inner primitives and re-implemented only the wrapper, which is what
 * this rule exists to stop.
 */
const TABLE_WORKLIST = [
    'pages/admin/BackupRestore.jsx',
    'pages/admin/ImportExport.jsx',
    'pages/admin/SecurityActivity.jsx',
    'pages/NotificationDiagnostics.jsx',
    'pages/SponsorManagement.jsx',
    'pages/VoucherManagement.jsx',
    'components/admin/analytics/AnalyticsHistoryTable.jsx',
    'components/admin/analytics/DailyDetailModal.jsx',
    'components/admin/analytics/TopVisitorsCard.jsx',
    'components/admin/analytics/ViewerAnalyticsSessionsSection.jsx',
    'components/admin/cameras/CameraHealthDebugPanel.jsx',
    'components/admin/recordings/RecordingAssuranceTable.jsx',
    'components/admin/recordings/RecordingRestartLogs.jsx',
    'components/admin/telegramArchive/CameraRouting.jsx',
];

/* Not an admin route — keep the reason attached so the map cannot be padded silently. */
const TABLE_EXEMPT = {
    'pages/customer/MyPanduan.jsx': 'customer portal, CustomerLayout not AdminLayout',
};

describe('guardrail: admin tables are wrapped by TableShell', () => {
    const tableFiles = ['pages', 'components/admin']
        .flatMap((d) => walk(path.join(SRC_ROOT, d)))
        .map(rel)
        .filter((r) => /<table[\s>]/.test(read(r)));

    it('no NEW table rolls its own scroll wrapper', () => {
        const offenders = tableFiles
            .filter((r) => !TABLE_WORKLIST.includes(r) && !(r in TABLE_EXEMPT))
            .filter((r) => !/TableShell/.test(read(r)));

        expect(
            offenders,
            `Wrap these in <TableShell> instead of a hand-rolled scroller: ${offenders.join(', ')}`,
        ).toEqual([]);
    });

    it('the worklist only shrinks — drop entries that have been migrated', () => {
        const stale = TABLE_WORKLIST.filter((r) => {
            const full = path.join(SRC_ROOT, r);
            return !fs.existsSync(full) || /TableShell/.test(fs.readFileSync(full, 'utf8'));
        });

        expect(
            stale,
            `Already on TableShell (or gone) — remove from TABLE_WORKLIST: ${stale.join(', ')}`,
        ).toEqual([]);
    });

    /* Anti-vacuity: a worklist that covered everything would make the rule above unfalsifiable. */
    it('the rule actually governs something — some tables are already migrated', () => {
        const migrated = tableFiles.filter((r) => /TableShell/.test(read(r)));

        expect(migrated.length).toBeGreaterThan(0);
    });
});
