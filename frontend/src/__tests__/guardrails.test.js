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
        'pages/AreaManagement.jsx': 847,
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

describe('guardrail: legacy grey ratchet (design tokens)', () => {
    // The 2026-07 token layer (surface/edge/content/status — see docs/frontend-guide.md)
    // replaces raw greys. Existing usages are frozen at the measured baseline: the count
    // may shrink as pages migrate, never grow. When you migrate a page, lower BASELINE
    // in the same PR so the ratchet tightens behind you.
    const BASELINE = 5700; // measured 2026-07-22 after public-surface token sweep (was 5865)

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
