// @vitest-environment jsdom
/*
Purpose: Lock the PageHeader contract the admin migration depends on — the eyebrow slot, the one
  agreed title size, the no-card rule, and the stack/min-w-0/shrink-0 trio that stops a page-level
  action button from squeezing its own title — plus a RATCHET on the routes still hand-rolling a
  title, so adoption cannot quietly drift back.
Caller: Vitest frontend jsdom suite (runs in the plain `npm test` gate and in a focused run).
Deps: components/ui/PageHeader, @testing-library/react, fs (for the adoption ratchet).
MainFuncs: PageHeader rendering assertions; admin hand-rolled-title ratchet.
SideEffects: None.

Why a ratchet lives in a component test file: the admin surface's own evidence is that a
convention held by a PROVIDER or a TEST is universal (zero window.confirm in the tree, one toast
store) while a convention held by a comment in a barrel file is a coin flip — PageHeader itself
stalled at 10 of 30 routes under exactly such a comment. Unlike src/__tests__/guardrails.test.js
this file is not skipped by a focused `npm test -- PageHeader` run.
*/

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PageHeader } from './PageHeader';

const h1 = () => screen.getByRole('heading', { level: 1 });

describe('PageHeader', () => {
    it('renders the title as the page\'s single h1', () => {
        render(<PageHeader title="Dasbor Rekaman" />);
        expect(h1().textContent).toBe('Dasbor Rekaman');
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('renders description, meta and actions only when given', () => {
        const { container, rerender } = render(<PageHeader title="Area" />);
        expect(container.querySelectorAll('p')).toHaveLength(0);
        expect(container.querySelectorAll('button')).toHaveLength(0);

        rerender(
            <PageHeader
                title="Area"
                description="Kelola area dan kamera di dalamnya."
                meta={<span>12 area</span>}
                actions={<button type="button">Tambah area</button>}
            />,
        );
        expect(screen.getByText('Kelola area dan kamera di dalamnya.')).toBeTruthy();
        expect(screen.getByText('12 area')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Tambah area' })).toBeTruthy();
    });

    describe('eyebrow slot', () => {
        it('renders the category label before the title in document order', () => {
            const { container } = render(<PageHeader eyebrow="Operations" title="Diagnostik Kesehatan" />);
            const label = screen.getByText('Operations');
            expect(label.compareDocumentPosition(h1()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(container.contains(label)).toBe(true);
        });

        it('is not a heading, so the route still starts its outline at h1', () => {
            render(<PageHeader eyebrow="Keamanan" title="Aktivitas Keamanan" />);
            const label = screen.getByText('Keamanan');
            expect(label.tagName).toBe('P');
            expect(screen.getAllByRole('heading')).toHaveLength(1);
        });

        it('carries its meaning by size, weight and case — not by colour alone', () => {
            render(<PageHeader eyebrow="Viewer Analytics" title="Statistik Penonton" />);
            const cls = screen.getByText('Viewer Analytics').className;
            expect(cls).toContain('uppercase');
            expect(cls).toContain('font-semibold');
            // Smaller than the description it sits above, so the two never read as one block.
            expect(cls).toContain('text-xs');
        });

        it('adds no node and no spacing when omitted', () => {
            const { container } = render(<PageHeader title="Iklan" />);
            expect(container.querySelectorAll('p')).toHaveLength(0);
            expect(h1().className).not.toContain('mt-1');
        });
    });

    describe('the settled title size (see the measurement table in PageHeader.jsx)', () => {
        it('is 20px while the title owns a phone\'s full width and 24px once it shares a row', () => {
            render(<PageHeader title="Dasbor Rekaman" />);
            const cls = h1().className;
            expect(cls).toContain('text-xl');
            expect(cls).toContain('sm:text-2xl');
        });

        it('never renders the larger size unconditionally — that wraps 20 of 28 admin titles at 320px/1.5x', () => {
            render(<PageHeader title="IP Kamera Pelanggan (Routing)" />);
            const cls = h1().className;
            expect(cls).not.toMatch(/(^|\s)text-2xl(\s|$)/);
            expect(cls).not.toMatch(/(^|\s)text-3xl(\s|$)/);
        });

        it('lets a long title break rather than push the layout sideways', () => {
            render(<PageHeader title="Perpustakaan Arsip Telegram" />);
            expect(h1().className).toContain('break-words');
        });
    });

    describe('the squeeze fix (SponsorManagement.jsx:351 hands its title 179px of a 320px phone)', () => {
        it('stacks the title above the actions until sm, then puts them on one row', () => {
            const { container } = render(<PageHeader title="Manajemen Sponsor" actions={<button type="button">Tambah</button>} />);
            const root = container.firstChild;
            expect(root.className).toContain('flex-col');
            expect(root.className).toContain('sm:flex-row');
        });

        it('lets the text column shrink and keeps the actions at their natural width', () => {
            const { container } = render(<PageHeader title="Manajemen Sponsor" actions={<button type="button">Tambah Sponsor</button>} />);
            const [text, actions] = container.firstChild.children;
            expect(text.className).toContain('min-w-0');
            expect(actions.className).toContain('shrink-0');
        });
    });

    describe('is never a panel (RecordingDashboard.jsx:106 boxed its header; that costs the title 42-62px)', () => {
        it('carries no card chrome', () => {
            const { container } = render(<PageHeader title="Dasbor Rekaman" description="Monitor recording aktif." />);
            expect(container.firstChild.className).not.toMatch(/\bborder\b|\bbg-surface\b|\bshadow-e|\brounded-/);
        });

        it('offers no prop to opt into one — a page-level knob is how the drift started', () => {
            // If someone re-adds a `card`/`variant` escape hatch, this renders chrome and fails.
            const { container } = render(<PageHeader title="Dasbor Rekaman" card variant="card" />);
            expect(container.firstChild.className).not.toMatch(/\bborder\b|\bbg-surface\b|\bshadow-e|\brounded-/);
        });
    });
});

/* ------------------------------------------------------------------ adoption ratchet
 *
 * 30 admin routes. 10 render PageHeader, 19 hand-roll an <h1>, and /admin/playback has no title
 * block at all. The 19 below are the migration's worklist.
 *
 * WHEN YOU MIGRATE A PAGE, DELETE ITS LINE. The staleness assertion fails while an entry no longer
 * hand-rolls an <h1>, so the list cannot rot into a lie, and the drift assertion fails if a new
 * admin page or admin component grows its own <h1> — which is how this component stalled at a
 * third of the surface the first time.
 *
 * 2026-08-22: nine entries cleared — RondaSettings, VehicleCountSettings, TelegramArchiveSettings
 * (three <h1>s: loading, unavailable, loaded), CustomerCameraIPs, admin/SecurityActivity,
 * admin/ImportExport, admin/BackupRestore and analytics/AnalyticsWorkspace, which now composes
 * PageHeader instead of hand-rolling the title for both analytics routes.
 * analytics/ViewerAnalyticsHeader.jsx left the list by being DELETED, not migrated: it rendered a
 * second, richer header for /admin/analytics and had had zero importers for months, so migrating
 * it would have moved dead code onto the primitive and kept two page-header components alive.
 *
 * 2026-08-22: the last ten cleared — AreaManagement, SponsorManagement, PromoBannerManagement,
 * VoucherManagement, RecordingDashboard, BillingManagement, FeedbackManagement,
 * PlaybackTokenManagement, NotificationDiagnostics and admin/HealthDebug. RecordingDashboard also
 * lost the card wrapper around its header and admin/HealthDebug the surface's only `text-3xl`
 * title, so the seven title sizes the primitive was measured against are now one.
 *
 * THE WORKLIST IS EMPTY, AND THAT IS THE POINT: with nothing left to exempt, the first assertion
 * below stops being a ratchet and becomes a flat rule — no file under pages/ or components/admin/
 * may render its own <h1> at all. Do not re-open the list to land a new page; render PageHeader.
 */
const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNED = ['pages', 'components/admin'];

const HAND_ROLLED = [];

/* Not admin routes, or not a page title — these own their <h1> legitimately and are out of the
 * migration's scope. Keep the reason attached so the list cannot be padded to silence a failure. */
const EXEMPT = {
    'pages/AreaPublicPage.jsx': 'public surface, not an admin route',
    'pages/SupportPage.jsx': 'public surface (/dukungan), not an admin route',
    'pages/LoginPage.jsx': 'public auth screen',
    'pages/RegisterPage.jsx': 'public rental sign-up',
    'pages/customer/MyPanduan.jsx': 'customer portal, CustomerLayout not AdminLayout',
    'pages/customer/MyRecordings.jsx': 'customer portal, CustomerLayout not AdminLayout',
    'pages/Dashboard.jsx': 'already renders PageHeader; its remaining h1 is the load-failure screen',
};

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
const hasOwnH1 = (f) => /<h1[\s>]/.test(fs.readFileSync(f, 'utf8'));

describe('guardrail: admin page titles come from PageHeader', () => {
    const files = SCANNED.flatMap((d) => walk(path.join(SRC_ROOT, d)));

    it('no admin page or admin component outside the worklist hand-rolls its own <h1>', () => {
        const offenders = files
            .filter(hasOwnH1)
            .map(rel)
            .filter((r) => !HAND_ROLLED.includes(r) && !(r in EXEMPT));
        expect(
            offenders,
            `\nThese admin files grew a hand-rolled <h1>. Render <PageHeader title=… /> from `
            + `components/ui instead (props documented at the top of PageHeader.jsx):\n  `
            + `${offenders.join('\n  ')}\n`,
        ).toEqual([]);
    });

    it('the worklist has no stale entries — a migrated page must be removed from it', () => {
        const stale = HAND_ROLLED.filter((r) => {
            const full = path.join(SRC_ROOT, r);
            return fs.existsSync(full) && !hasOwnH1(full);
        });
        expect(
            stale,
            `\nThese pages no longer hand-roll an <h1> — delete their lines from HAND_ROLLED so the `
            + `ratchet tightens:\n  ${stale.join('\n  ')}\n`,
        ).toEqual([]);
    });

    it('every worklist entry still exists, so a rename cannot silently drop a route', () => {
        const missing = HAND_ROLLED.filter((r) => !fs.existsSync(path.join(SRC_ROOT, r)));
        expect(missing, `\nWorklist entries not found on disk: ${missing.join(', ')}\n`).toEqual([]);
    });
});
