/**
 * guardrails.test.js — frontend anti-"penumpukan" file-size ratchet.
 * Runs in the normal `npm test` gate. New components/pages must stay under MAX; the known
 * oversized files are FROZEN at current size (may shrink, not grow). To change a frozen value,
 * edit the baseline here in the same PR so growth is a visible decision, not silent drift.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'coverage', 'dist', 'build']);
const TEST_RE = /\.(test|spec)\.(js|jsx)$/;

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(js|jsx)$/.test(entry.name) && !TEST_RE.test(entry.name)) out.push(full);
    }
    return out;
}
const rel = (f) => path.relative(SRC_ROOT, f).split(path.sep).join('/');
const lineCount = (f) => fs.readFileSync(f, 'utf8').split('\n').length - 1;

describe('guardrail: frontend file-size ratchet (anti-penumpukan)', () => {
    const MAX = 800;
    const FROZEN = {
        'components/MultiView/VideoPopup.jsx': 1608,
        'components/MultiView/MultiViewVideoItem.jsx': 1196,
        'components/MapView.jsx': 1176,
        'pages/Playback.jsx': 1160,
        'pages/AreaManagement.jsx': 845,
    };

    const files = walk(SRC_ROOT);

    it('no NEW file exceeds the size budget; frozen large files do not grow', () => {
        const offenders = [];
        for (const f of files) {
            const r = rel(f);
            const n = lineCount(f);
            const ceiling = FROZEN[r] ?? MAX;
            if (n > ceiling) {
                offenders.push(`${r}: ${n} ln > ${ceiling}${FROZEN[r] ? ' (frozen — extract a hook/sub-component, do not grow)' : ' (over budget — extract page state into hooks/ and split widgets)'}`);
            }
        }
        expect(offenders, `\nFile-size ratchet tripped:\n  ${offenders.join('\n  ')}\n`).toEqual([]);
    });

    it('frozen baseline has no stale entries (a slimmed file should be removed from FROZEN)', () => {
        const stale = Object.keys(FROZEN).filter((r) => {
            const full = path.join(SRC_ROOT, r);
            return fs.existsSync(full) && lineCount(full) <= MAX;
        });
        expect(stale, `These files dropped under ${MAX} ln — remove from FROZEN to tighten the ratchet: ${stale.join(', ')}`).toEqual([]);
    });
});

/*
 * Mobile-viewport & design-token guards. Every rule below was earned by a specific
 * production bug on the public frontend (2026-07 mobile zoom-out incident + UI
 * reconstruction) — see docs/frontend-guide.md "Mobile viewport hard rules" for the
 * full story behind each one. These are deliberately mechanical: they assert exact
 * strings/counts, so a trip means a human decided to change a load-bearing guard.
 */
describe('guardrail: mobile viewport regressions', () => {
    const FRONTEND_ROOT = path.resolve(SRC_ROOT, '..');
    const read = (p) => fs.readFileSync(path.join(FRONTEND_ROOT, p), 'utf8');

    it('index.html keeps minimum-scale=1.0 and never disables pinch-zoom-in', () => {
        // In-app WebViews (Telegram etc.) fit their initial zoom to the widest content,
        // so one wide element (typically an ad iframe) shrinks the whole page into a
        // narrow column. minimum-scale=1.0 forbids that mechanically.
        const meta = (read('index.html').match(/<meta name="viewport"[^>]*>/) || [''])[0];
        expect(meta, 'viewport meta missing from index.html').toContain('width=device-width');
        expect(meta, 'minimum-scale=1.0 is the guard against WebView zoom-out-to-fit').toContain('minimum-scale=1.0');
        expect(meta, 'maximum-scale / user-scalable break pinch-zoom accessibility').not.toMatch(/maximum-scale|user-scalable/);
    });

    it('index.css keeps overflow-x: clip on the roots (never hidden) and the ad-iframe clamp', () => {
        // Strip comments first: the rules below assert against DECLARATIONS, and the
        // stylesheet's own prose explains "clip, NOT hidden" in a comment.
        const css = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(
            (css.match(/overflow-x:\s*clip/g) || []).length,
            'html AND body must keep overflow-x: clip'
        ).toBeGreaterThanOrEqual(2);
        // `hidden` would turn <html> into a scroll container and silently kill
        // position: sticky on every descendant (simple-mode header, admin shell).
        expect(css).not.toMatch(/overflow-x:\s*hidden/);
        // Tailwind preflight caps img/video only; third-party ad iframes with fixed
        // pixel widths walk through exactly that gap.
        expect(css, 'iframe/embed/object/canvas max-width clamp missing').toMatch(/iframe[\s\S]{0,80}max-width:\s*100%/);
    });

    it('no class string sizes a fixed element with 100vw, and w-screen is banned outright', () => {
        // fixed elements escape the root overflow-x: clip guard, and 100vw resolves
        // against the initial containing block — it grows with the very overflow it
        // causes. Size floating chrome with insets (left-4 right-4) instead.
        const LITERAL_RE = /(["'`])(?:(?!\1)[\s\S])*?\1/g;
        const offenders = [];
        for (const f of walk(SRC_ROOT)) {
            for (const lit of (fs.readFileSync(f, 'utf8').match(LITERAL_RE) || [])) {
                if (/\bw-screen\b/.test(lit)) {
                    offenders.push(`${rel(f)}: w-screen (viewport-unit sizing — use insets or width tokens)`);
                }
                if (/\bfixed\b/.test(lit) && /100vw/.test(lit)) {
                    offenders.push(`${rel(f)}: fixed + 100vw in one class string (use left-*/right-* insets)`);
                }
            }
        }
        expect(offenders, `\nViewport-unit guard tripped:\n  ${offenders.join('\n  ')}\n`).toEqual([]);
    });
});

describe('guardrail: one owner for the page gutter', () => {
    /*
     * AdminLayout wraps every route in `px-4 lg:px-8` + `mx-auto max-w-7xl`. A page that pads its
     * own root is inset TWICE, and the result is visible on a phone: Kamera rendered flush at 16px
     * while Sponsor/Iklan/Voucher sat at 40px, so the content column changed width page to page.
     * TelegramArchive did the opposite and capped itself narrower than every other route.
     *
     * Vertical rhythm (space-y-*) is the page's business. Horizontal gutters and max width are the
     * shell's, and only the shell's.
     */
    const ADMIN_PAGE_RE = /^pages\//;
    const ROOT_RETURN_RE = /\n {4}return \(\s*\n\s*<div className="([^"]*)"/;
    const BAD_ROOT = /(^|\s)(p|px)-\d|(^|\s)max-w-/;
    // Auth screens render OUTSIDE AdminLayout, so they legitimately own their full-screen frame.
    const STANDALONE = /(LoginPage|RegisterPage)\.jsx$/;
    // A root that IS a card carries card padding, not a page gutter.
    const isCard = (cls) => /\brounded-/.test(cls) && /\bborder\b/.test(cls);

    it('no admin page pads or width-caps its own root — the shell owns that', () => {
        const offenders = [];
        for (const f of walk(SRC_ROOT)) {
            const r = rel(f);
            if (!ADMIN_PAGE_RE.test(r) || r.includes('Landing') || r.includes('AreaPublic')) continue;
            if (STANDALONE.test(r)) continue;
            const m = fs.readFileSync(f, 'utf8').match(ROOT_RETURN_RE);
            if (m && BAD_ROOT.test(m[1]) && !isCard(m[1])) {
                offenders.push(`${r}: root <div class="${m[1]}"> — drop the gutter/max-width, AdminLayout supplies it`);
            }
        }
        expect(offenders, `\nDouble page gutter:\n  ${offenders.join('\n  ')}\n`).toEqual([]);
    });
});

describe('guardrail: legacy grey ratchet (design tokens)', () => {
    // The 2026-07 token layer (surface/edge/content/status — see docs/frontend-guide.md)
    // replaces raw greys. Existing usages are frozen at the measured baseline: the count
    // may shrink as pages migrate, never grow. When you migrate a page, lower BASELINE
    // in the same PR so the ratchet tightens behind you.
    // 2026-07-27 admin reconstruction: 5700 -> 1212. The admin surface held 4,630 of the 5,292
    // greys in the tree (87%). It was swept by exact light+dark PAIR inside a single className and
    // then page by page as each moved onto the components/ui primitives — never by collapsing a
    // lone grey, since an unpaired grey is a judgement call about which role was meant. What is
    // left is exactly those singletons; resolve them by hand and lower this again.
    const BASELINE = 778;

    it(`-gray-N usage count stays <= ${BASELINE} and shrinks over time`, () => {
        let count = 0;
        for (const f of walk(SRC_ROOT)) {
            count += (fs.readFileSync(f, 'utf8').match(/-gray-\d+/g) || []).length;
        }
        expect(
            count,
            `\n-gray-N usages grew to ${count} (baseline ${BASELINE}). New work must use the semantic tokens ` +
            '(surface/edge/content/status — docs/frontend-guide.md). If you migrated code and the count DROPPED, ' +
            'lower BASELINE in this file to lock in the gain.\n'
        ).toBeLessThanOrEqual(BASELINE);
    });
});

describe('guardrail: only real semantic tokens (typo-proofing)', () => {
    // Tailwind silently drops a class whose token does not exist, so `text-status-ok` rendered as
    // *no colour at all* — invisible success text shipped to production before anyone noticed.
    // These lists mirror tailwind.config.js; extend both together when a token is genuinely added.
    const VALID = {
        status: ['live', 'warn', 'fault', 'idle'],
        surface: ['sunken', 'raised', 'overlay'],
        content: ['muted', 'subtle'],
        edge: ['strong'],
    };
    const PREFIX = '(?:text|bg|border|ring|fill|stroke|divide|from|to|via|decoration|outline|shadow|accent|caret|placeholder)';

    it('every status/surface/content/edge modifier used in JSX is defined', () => {
        const offenders = [];
        for (const role of Object.keys(VALID)) {
            const re = new RegExp(`${PREFIX}-${role}-([a-z][a-z0-9-]*)`, 'g');
            for (const f of walk(SRC_ROOT)) {
                const src = fs.readFileSync(f, 'utf8');
                for (const m of src.matchAll(re)) {
                    // strip Tailwind opacity/state suffixes: status-live/30, content-muted
                    const modifier = m[1].split('/')[0];
                    if (!VALID[role].includes(modifier)) {
                        offenders.push(`${rel(f)}: ${m[0]} — no such token (${role}: ${VALID[role].join(', ')})`);
                    }
                }
            }
        }
        expect(
            [...new Set(offenders)],
            `\nUndefined design token used — Tailwind drops these silently, so the element renders unstyled:\n  ${
                [...new Set(offenders)].join('\n  ')}\n`,
        ).toEqual([]);
    });
});
