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

describe('guardrail: unhashed public/ scripts must be cache-busted', () => {
    /*
     * Vite content-hashes everything it builds, so /assets/* can safely be served immutable.
     * Files copied verbatim from public/ get NO hash — but the edge serves them with the same
     * `Cache-Control: immutable, max-age=1y`. Result (observed 2026-07-28): an edited
     * meta-config.js sat at the CDN for 30 DAYS (Age 2,629,151, cf-cache-status HIT) while the
     * origin had the new copy, so the fix it carried never reached a single visitor.
     *
     * index.html itself is never edge-cached, so a ?v= on the reference is the only lever that
     * actually ships a change. Bump it whenever the file changes.
     */
    const FRONTEND_ROOT = path.resolve(SRC_ROOT, '..');
    const SCRIPT_SRC_RE = /<script[^>]+src="(\/[^"]+\.js[^"]*)"/g;

    it('every non-/assets script in index.html carries a ?v= version', () => {
        const html = fs.readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf8');
        const offenders = [];
        for (const match of html.matchAll(SCRIPT_SRC_RE)) {
            const src = match[1];
            if (src.startsWith('/assets/') || src.startsWith('/src/')) continue; // hashed by Vite
            if (!/\?v=/.test(src)) offenders.push(src);
        }
        expect(
            offenders,
            `\nUnhashed public/ script without ?v= — the edge will pin the old copy for a year:\n  ${
                offenders.join('\n  ')}\n`,
        ).toEqual([]);
    });
});

describe('guardrail: the two PWAs keep separate, stable identities', () => {
    /*
     * Public and admin are two installable apps served from ONE origin, told apart only by their
     * manifest `id`/`scope`/`start_url`. Get that wrong and the damage lands on someone's home
     * screen, where it cannot be fixed by a deploy:
     *   - drop `id` and identity falls back to start_url, so an edit can orphan every existing
     *     install into a duplicate ghost icon;
     *   - let the scopes overlap and the browser may treat admin as the same app as public,
     *     which is exactly what this split exists to stop.
     * The public `id` MUST stay "/" — that is the identity browsers already derived when the field
     * was absent, so it is what currently-installed apps are keyed by.
     */
    const FRONTEND_ROOT = path.resolve(SRC_ROOT, '..');
    const readManifest = (name) => JSON.parse(fs.readFileSync(path.join(FRONTEND_ROOT, 'public', name), 'utf8'));

    it('public manifest keeps the identity existing installs are keyed by', () => {
        const pub = readManifest('site.webmanifest');
        expect(pub.id, 'changing this orphans every installed public app').toBe('/');
        expect(pub.scope).toBe('/');
        expect(pub.start_url).toBe('/');
    });

    it('admin manifest is a distinct app scoped to /admin', () => {
        const admin = readManifest('admin.webmanifest');
        expect(admin.id).toBe('/admin');
        expect(admin.scope).toBe('/admin');
        expect(admin.start_url.startsWith('/admin')).toBe(true);
        const pub = readManifest('site.webmanifest');
        expect(admin.id).not.toBe(pub.id);
        expect(admin.name).not.toBe(pub.name);
    });

    it('the two apps do not share an icon — identical icons defeat the split', () => {
        const iconSrcs = (m) => new Set(m.icons.map((i) => i.src));
        const pub = iconSrcs(readManifest('site.webmanifest'));
        const admin = iconSrcs(readManifest('admin.webmanifest'));
        const shared = [...admin].filter((src) => pub.has(src));
        expect(shared, `both manifests point at ${shared.join(', ')} — they would be indistinguishable`).toEqual([]);
    });

    it('every icon and shortcut target referenced by either manifest exists', () => {
        const missing = [];
        for (const name of ['site.webmanifest', 'admin.webmanifest']) {
            for (const icon of readManifest(name).icons) {
                if (!fs.existsSync(path.join(FRONTEND_ROOT, 'public', icon.src.replace(/^\//, '')))) {
                    missing.push(`${name}: ${icon.src}`);
                }
            }
        }
        // A manifest whose icons 404 is silently not installable on Android.
        expect(missing).toEqual([]);
    });

    it('admin shortcuts stay inside the admin scope, public shortcuts stay out of it', () => {
        const adminOutside = readManifest('admin.webmanifest').shortcuts
            .filter((s) => !s.url.startsWith('/admin')).map((s) => s.url);
        const publicInside = readManifest('site.webmanifest').shortcuts
            .filter((s) => s.url.startsWith('/admin')).map((s) => s.url);
        expect(adminOutside, 'a shortcut outside scope opens in a browser tab, not the app').toEqual([]);
        expect(publicInside, 'admin links do not belong in the public app').toEqual([]);
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
            // Public pages render under PublicPageRoute, which supplies NO shell — so unlike admin
            // routes they legitimately own their own gutter and width cap. Keep this list to pages
            // that genuinely render outside AdminLayout; it is not an escape hatch for admin pages.
            const isPublicShellLess = r.includes('Landing') || r.includes('AreaPublic') || r.includes('PlaybackAccess');
            if (!ADMIN_PAGE_RE.test(r) || isPublicShellLess) continue;
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
    // 2026-07-28: 778 -> 660. The shared ui/ primitives (EmptyState, Skeleton, ErrorBoundary) held
    // 116 of them; because the semantic tokens are already theme-aware, every `x-gray-N
    // dark:x-gray-M` pair collapsed to a single class and the `dark:` variant disappeared with it.
    // Fixing a shared primitive is worth more than a page: the result propagates everywhere it is
    // used. The only greys left there are Skeleton's video-tile gradient, which is deliberately
    // dark in BOTH themes (over-video chrome — see docs/frontend-guide.md).
    // 2026-08-22, migrasi chrome admin (tab strip + PageHeader + TableShell): 613 -> 608.
    //
    // Angka BASELINE lama, 660, sudah BASI sejak dua commit sebelumnya — perbaikan luapan admin
    // dan konversi modal masing-masing menghapus grey tanpa pernah menurunkan plafonnya. Jadi
    // hitungan sebenarnya sebelum fase ini adalah 613, bukan 660, dan fase ini menghapus LIMA,
    // bukan lima puluh dua. Nilai 608 benar; ceritanya yang harus jujur.
    //
    // Dicatat begini karena repo ini pernah membayar mahal untuk komentar penjaga yang berisi
    // KLAIM alih-alih bukti — sapuan permukaan publik menemukan tiga komentar keamanan yang
    // menyatakan properti yang tidak dimiliki kodenya, dan justru komentar itulah yang membuat
    // pembaca berikutnya berhenti memeriksa. Sebuah berkas penjaga adalah tempat terakhir yang
    // boleh menyimpan angka karangan.
    //
    // Kelima yang benar-benar hilang di fase ini: `hover:text-gray-800 dark:hover:text-gray-200`
    // pada tombol tab buatan tangan BillingManagement (2), pasangan `bg-white dark:bg-gray-800/80`
    // pada filter area yang sebenarnya hanya `bg-surface` dieja panjang, dan isian
    // `bg-gray-500 hover:bg-gray-600` pada sakelar fitur voucher yang tidak sadar tema sama sekali
    // — keadaan "mati"-nya menampilkan abu yang sama di mode gelap dan terang.
    //
    // Pelajaran yang tetap berlaku: mengadopsi primitif menghapus grey sebagai efek samping,
    // karena grey legacy hidup persis di markup yang digantikan. Turunkan angka ini setiap kali,
    // jangan biarkan basi lagi seperti 660.
    const BASELINE = 608;

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

    /*
     * The list above only proves the token NAME exists. It deliberately strips the `/NN` opacity
     * suffix — which made it blind to a second silent-drop: Tailwind cannot compute alpha for a
     * colour declared as a bare `var(--x)` string, so `bg-edge/50` compiled to NOTHING while
     * `bg-edge` compiled fine. 88 usages across 26 files (bg-status-fault/10, border-edge/50, …)
     * were dead in production: skeletons rendered with no background at all, and `border-edge/50`
     * fell back to Tailwind preflight's light grey in BOTH themes.
     *
     * The fix is at the source — tokens are now `rgb(var(--x) / <alpha-value>)` over channel
     * triplets — so this guard defends that form. Revert a token to bare `var(--x)` and every
     * `token/NN` in the app silently dies again.
     */
    it('every semantic token is declared alpha-capable, so `token/NN` cannot silently vanish', () => {
        const config = fs.readFileSync(path.resolve(SRC_ROOT, '..', 'tailwind.config.js'), 'utf8');
        const ROLE_RE = /'(?:rgb\()?var\(--((?:surface|edge|content|status|data)(?:-[a-z]+)?)\)(?:[^']*)?'/g;
        const offenders = [];
        for (const m of config.matchAll(ROLE_RE)) {
            if (!/rgb\(var\(--[a-z-]+\) \/ <alpha-value>\)/.test(m[0])) {
                offenders.push(`--${m[1]}: ${m[0]} — must be 'rgb(var(--${m[1]}) / <alpha-value>)'`);
            }
        }
        expect(
            offenders,
            `\nToken declared without alpha support — every \`token/NN\` utility using it compiles to nothing:\n  ${
                offenders.join('\n  ')}\n`,
        ).toEqual([]);
    });

    it('token CSS variables hold channel triplets, not hex (hex breaks the alpha form)', () => {
        const css = fs.readFileSync(path.join(SRC_ROOT, 'index.css'), 'utf8');
        const offenders = [...css.matchAll(/--((?:surface|edge|content|status|data)(?:-[a-z]+)?):\s*(#[0-9a-fA-F]{3,8})/g)]
            .map((m) => `--${m[1]}: ${m[2]} — use space-separated channels, e.g. 228 231 235`);
        expect(
            [...new Set(offenders)],
            `\nSemantic token still a hex literal; \`rgb(var(--x) / <alpha>)\` cannot consume it:\n  ${
                [...new Set(offenders)].join('\n  ')}\n`,
        ).toEqual([]);
    });

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

describe('guardrail: a themed canvas must theme its text too', () => {
    /*
     * The bug this exists to prevent, in full, because it cost real time to find:
     *
     * `@layer base { body { background-color: rgb(var(--surface-sunken)); } }` themed the canvas but
     * said nothing about colour, so text fell back to the browser default black. Every element that
     * did not name its own text colour therefore inherited black — invisible on a dark canvas. It
     * stayed hidden for months because almost every component happens to carry a `text-*` class; the
     * one <code> that did not rendered #000 on #08090b, contrast 1.05 where WCAG AA wants 4.5.
     *
     * The rule is deliberately about PAIRING, not about specific values. Theming one half of the
     * foreground/background pair is the mistake; which token you pick is a design decision.
     */
    // fs directly: the `read` helper above is scoped to another describe block.
    const css = fs.readFileSync(path.join(SRC_ROOT, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    const bodyRules = [...css.matchAll(/body\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');

    it('body sets a themed foreground wherever it sets a themed background', () => {
        const themedBg = /background-color:\s*rgb\(var\(--surface/.test(bodyRules);
        const themedFg = /(^|[^-])color:\s*rgb\(var\(--content/.test(bodyRules);

        expect(
            themedBg && !themedFg,
            '\nbody themes its background but not its text colour.\n'
            + 'Everything that omits a text-* class will inherit the browser default (black) and\n'
            + 'disappear on the dark canvas. Add `color: rgb(var(--content));` next to it.\n',
        ).toBe(false);
    });

    it('body does not hard-code a literal text colour', () => {
        // A literal here re-creates the same trap from the other direction: it cannot follow the theme.
        const literal = bodyRules.match(/(^|[^-])color:\s*(#[0-9a-f]{3,8}|black|white|rgb\(\s*\d)/i);
        expect(
            literal ? literal[0].trim() : null,
            '\nbody hard-codes a text colour, so it cannot follow the theme. Use rgb(var(--content)).\n',
        ).toBe(null);
    });
});

describe('guardrail: an option/prop the receiver never reads is dropped in silence', () => {
    /*
     * Same failure shape as the token typo-proofing above, one layer up: JavaScript does not care
     * that nobody reads your key, and React does not care that nobody declared your prop. Both
     * throw the value away without a word, and the call site keeps working — it just stops saying
     * what it was written to say. Three of these shipped:
     *
     *   - TelegramArchiveSettings passed `confirmText`/`variant`; useConfirm reads `confirmLabel`
     *     and `tone`, so a destructive delete asked with the default "Ya" and no danger colour.
     *   - VoucherManagement passed the consequences of locking public cameras as `body`; useConfirm
     *     reads `message`, so the dialog asked the question with the consequences nowhere on screen.
     *   - DashboardStreams passed `onAddCamera` to a preset that declared no props, so the wired
     *     navigation was dead and the empty state offered no way out.
     *
     * Every one of them was found by hand, months later. Scoped deliberately: these two receivers
     * are small, closed lists, which is what makes a static check honest here rather than a
     * best-effort prop-type reimplementation.
     */
    const sources = walk(SRC_ROOT).map((f) => [rel(f), fs.readFileSync(f, 'utf8')]);
    // Comments live INSIDE several of these argument objects (they explain the copy). Dropping them
    // first is what keeps the key regexes below reading code rather than prose.
    const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    /** The argument text of a call, read by balancing parentheses from `open`. */
    const argOf = (src, open) => {
        let depth = 0;
        for (let i = open; i < src.length; i++) {
            if (src[i] === '(') depth++;
            else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
        }
        return '';
    };

    it('every useConfirm option is a key ConfirmContext actually renders', () => {
        // Mirrors the destructuring in contexts/ConfirmContext.jsx — extend both together.
        const API = ['title', 'message', 'confirmLabel', 'cancelLabel', 'tone'];
        const offenders = [];
        for (const [r, raw] of sources) {
            if (r === 'contexts/ConfirmContext.jsx') continue; // the definition, not a call site
            const src = decomment(raw);
            // `[^.\w]` keeps window.confirm() and showConfirm() out of the sweep.
            for (const m of src.matchAll(/(?:^|[^.\w])confirm\s*\(/g)) {
                const arg = argOf(src, m.index + m[0].length - 1).trim();
                if (!arg.startsWith('{')) continue; // confirm('plain string') is a supported form
                for (const k of arg.matchAll(/[{,]\s*(\w+)\s*:/g)) {
                    if (!API.includes(k[1])) offenders.push(`${r}: confirm({ ${k[1]}: … }) — not read (API: ${API.join(', ')})`);
                }
            }
        }
        expect(
            offenders,
            `\nuseConfirm option nobody reads — the dialog renders without it and nothing warns:\n  ${offenders.join('\n  ')}\n`,
        ).toEqual([]);
    });

    it('every prop passed to an EmptyState preset is one the preset declares', () => {
        const emptyState = fs.readFileSync(path.join(SRC_ROOT, 'components/ui/EmptyState.jsx'), 'utf8');
        const declared = {};
        for (const m of emptyState.matchAll(/export function (\w+)\(([^)]*)\)/g)) {
            const params = m[2].trim();
            declared[m[1]] = params.startsWith('{')
                ? [...params.matchAll(/(\w+)\s*(?:=[^,}]*)?\s*[,}]/g)].map((p) => p[1])
                : [];
        }
        // React reads these itself; they never reach the component's props.
        const REACT_OWNED = ['key', 'ref'];
        const offenders = [];
        for (const [r, raw] of sources) {
            if (r === 'components/ui/EmptyState.jsx') continue;
            for (const name of Object.keys(declared)) {
                for (const m of raw.matchAll(new RegExp(`<${name}[\\s/>]`, 'g'))) {
                    // Brace-aware: an attribute value can contain '>' (`onAddCamera={() => nav()}`),
                    // so scanning to the first '>' would cut the tag in half and miss props.
                    let depth = 0;
                    let i = m.index + name.length + 1;
                    for (; i < raw.length; i++) {
                        if (raw[i] === '{') depth++;
                        else if (raw[i] === '}') depth--;
                        else if (raw[i] === '>' && depth === 0) break;
                    }
                    const attrs = raw.slice(m.index + name.length + 1, i);
                    for (const a of attrs.matchAll(/(?:^|\s)(\w+)=/g)) {
                        if (!declared[name].includes(a[1]) && !REACT_OWNED.includes(a[1])) {
                            offenders.push(`${r}: <${name} ${a[1]}={…}> — ${name}() declares ${declared[name].length ? declared[name].join(', ') : 'no props'}`);
                        }
                    }
                }
            }
        }
        expect(
            offenders,
            `\nProp React will drop on the floor — declare it in EmptyState.jsx or stop passing it:\n  ${offenders.join('\n  ')}\n`,
        ).toEqual([]);
    });
});
