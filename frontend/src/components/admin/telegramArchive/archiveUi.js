/*
 * Purpose: Shared Tailwind class recipes for the Telegram archive admin screens, so the form, route
 *          list, routing table, and activity panel stay visually identical.
 * Caller: components/admin/telegramArchive/*, pages/TelegramArchiveSettings.jsx.
 * Deps: none (semantic design tokens from index.css).
 * MainFuncs: input, label, hint, btnGhost, btnPrimary, btnDanger, card, cardHead.
 *
 * Controls are min-h-11 (44px) to meet the touch-target minimum, and inputs are text-base on mobile
 * because iOS auto-zooms any field under 16px.
 */

const focusRing =
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 '
    + 'focus-visible:ring-offset-surface-raised';

export const card = 'rounded-card border border-edge bg-surface-raised shadow-e1';

export const cardHead =
    'flex items-baseline justify-between gap-3 border-b border-edge px-4 py-3 sm:px-5';

export const cardTitle = 'text-sm font-semibold text-content';

export const input =
    'w-full min-h-11 rounded-control border border-edge bg-surface-sunken px-3 py-2.5 '
    + `text-base text-content placeholder:text-content-subtle sm:text-sm ${focusRing} `
    + 'focus:border-edge-strong disabled:opacity-50';

export const label = 'block text-xs font-medium uppercase tracking-wide text-content-muted mb-1.5';

export const hint = 'mt-1.5 text-xs leading-relaxed text-content-subtle';

export const btnGhost =
    'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-edge '
    + `px-3 text-xs font-medium text-content-muted transition-colors hover:border-edge-strong `
    + `hover:text-content ${focusRing} disabled:opacity-50`;

export const btnDanger =
    'inline-flex min-h-11 items-center justify-center rounded-control border border-transparent px-3 '
    + `text-xs font-medium text-status-fault transition-colors hover:border-status-fault/40 `
    + `hover:bg-status-fault/10 ${focusRing} disabled:opacity-50`;

// Matches the app-wide primary button (bg-primary-600 → 700 on hover). Note the brand fill with
// white text measures ~2.8:1 on the default palette — a palette-level issue shared by every admin
// page, not something to diverge on here.
export const btnPrimary =
    'inline-flex min-h-11 items-center justify-center rounded-control bg-primary-600 px-5 '
    + `text-sm font-semibold text-white transition-colors hover:bg-primary-700 ${focusRing} `
    + 'disabled:opacity-50';

export function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    const mb = bytes / 1048576;
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * What a route actually points at, in words an operator can act on.
 *
 * This used to answer `Kamera 1443`, which is not an answer: the page exists to show which CCTV
 * goes to which Telegram group, and a bare id makes that unknowable without opening another tab.
 * Worse, the row's headline is the route LABEL — free text that can say anything — so a route
 * carrying a private camera into a group named after a different one looked perfectly normal.
 * The camera name is the fact; the label is only what someone typed.
 *
 * The overview endpoint already ships `cameras` (id, name, areaId, areaName) and `areas` in the
 * very same payload, so this costs no extra request.
 *
 * @param {{scope: string, cameraId?: number, areaId?: number}} route
 * @param {{cameras?: Array, areas?: Array}} [lookup]
 * @returns {{name: string, id: string|null, detail: string|null, missing: boolean}}
 */
export function resolveRouteTarget(route, { cameras = [], areas = [] } = {}) {
    const same = (a, b) => Number(a) === Number(b);

    if (route.scope === 'camera') {
        const camera = cameras.find((item) => same(item.id, route.cameraId));
        if (!camera) {
            // A route aimed at a deleted camera archives nothing, forever, without complaining.
            // That is a real fault, so it reads like one instead of hiding as a plain id.
            return { name: `Kamera #${route.cameraId} sudah tidak ada`, id: null, detail: null, missing: true };
        }
        return {
            name: camera.name,
            id: `#${camera.id}`,
            detail: camera.areaName || 'Tanpa area',
            missing: false,
        };
    }

    if (route.scope === 'area') {
        const area = areas.find((item) => same(item.id, route.areaId));
        if (!area) {
            return { name: `Area #${route.areaId} sudah tidak ada`, id: null, detail: null, missing: true };
        }
        const count = cameras.filter((item) => same(item.areaId, route.areaId)).length;
        return { name: `Area ${area.name}`, id: null, detail: `${count} kamera perekam`, missing: false };
    }

    return { name: 'Semua kamera', id: null, detail: `${cameras.length} kamera perekam`, missing: false };
}
