/**
 * guardrails.test.js — anti-"penumpukan" ratchets (source-text guards, no new deps).
 * Runs inside the normal `npm test` gate. Each guard FREEZES the current good state and
 * blocks only NEW regressions, so it lands green. To intentionally change a frozen value,
 * edit the baseline here in the same PR — making the decision visible instead of silent drift.
 *
 * Guards: (1) file-size ratchet, (2) layering invariants (routes!=DB, services!=controllers/routes),
 * (3) no new `INSERT OR REPLACE`, (4) no new REAL money column in migrations.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'coverage', 'dist', 'build', 'data', '.git']);

function walk(dir, exts) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full, exts));
        else if (exts.some((x) => entry.name.endsWith(x))) out.push(full);
    }
    return out;
}
const rel = (f) => path.relative(BACKEND_ROOT, f).split(path.sep).join('/');
const lineCount = (f) => fs.readFileSync(f, 'utf8').split('\n').length - 1;
const read = (f) => fs.readFileSync(f, 'utf8');

describe('guardrail: file-size ratchet (anti-penumpukan)', () => {
    // New backend source files must stay under MAX. The known oversized files are FROZEN at their
    // current size: they may shrink (good) but not grow. Shrinking a frozen file below MAX? remove it here.
    const MAX = 800;
    const FROZEN = {
        'services/cameraHealthService.js': 3159,
        'services/cameraService.js': 2775,
        'services/hlsProxyService.js': 1581,
        'services/playbackTokenService.js': 1357,
        'middleware/schemaValidators.js': 949,
        'services/telegramService.js': 944,
        'services/externalStreamProxyService.js': 896,
        'services/telegramBotService.js': 890,
        // Central billing engine. Pure date/money helpers already live in billingCalc.js; the
        // remainder is the charge/suspend/heal state machine, kept in one file on purpose. Frozen
        // here (visible decision) after the timezone/admin-hold/catch-up/atomicity correctness pass;
        // bumped 818→831 for the is_public consent-preservation notes on the suspend/heal paths.
        'services/billingService.js': 831,
    };

    const files = walk(BACKEND_ROOT, ['.js']);

    it('no NEW file exceeds the size budget; frozen giants do not grow', () => {
        const offenders = [];
        for (const f of files) {
            const r = rel(f);
            const n = lineCount(f);
            const ceiling = FROZEN[r] ?? MAX;
            if (n > ceiling) {
                offenders.push(`${r}: ${n} ln > ${ceiling}${FROZEN[r] ? ' (frozen — extract/shrink, do not grow)' : ' (over budget — split into a focused module or extract helpers)'}`);
            }
        }
        expect(offenders, `\nFile-size ratchet tripped:\n  ${offenders.join('\n  ')}\n`).toEqual([]);
    });

    it('frozen baseline has no stale entries (a freed file should be removed from FROZEN)', () => {
        const stale = Object.keys(FROZEN).filter((r) => {
            const full = path.join(BACKEND_ROOT, r);
            return fs.existsSync(full) && lineCount(full) <= MAX;
        });
        expect(stale, `These files dropped under ${MAX} ln — remove them from FROZEN to tighten the ratchet: ${stale.join(', ')}`).toEqual([]);
    });
});

describe('guardrail: layering invariants', () => {
    it('no file under routes/ imports the DB layer (routes stay thin)', () => {
        const offenders = walk(path.join(BACKEND_ROOT, 'routes'), ['.js'])
            .filter((f) => /from\s+['"][^'"]*database\/(connectionPool|database)\.js['"]/.test(read(f)))
            .map(rel);
        expect(offenders, `Routes must delegate DB access to services: ${offenders.join(', ')}`).toEqual([]);
    });

    it('no service imports a controller or route (dependency arrow never points backward)', () => {
        const offenders = walk(path.join(BACKEND_ROOT, 'services'), ['.js'])
            .filter((f) => /from\s+['"]\.\.\/(controllers|routes)\//.test(read(f)))
            .map(rel);
        expect(offenders, `Services must not import controllers/routes: ${offenders.join(', ')}`).toEqual([]);
    });
});

describe('guardrail: data-safety patterns', () => {
    // `INSERT OR REPLACE` silently DELETEs the conflicting row on PK/UNIQUE conflict — the exact
    // pattern that once cost a real customer row. No NEW occurrences allowed.
    // 2026-07-28: backupService REMOVED from this list — its restore path now upserts on the primary
    // key, so a collision on another unique column raises instead of destroying someone else's row.
    // sessionManager stays: its target is token_blacklist keyed by token_hash, where replacing an
    // identical blacklist entry is idempotent and destroys nothing.
    const INSERT_OR_REPLACE_ALLOW = new Set([
        'services/sessionManager.js',
    ]);
    it('no NEW `INSERT OR REPLACE` in services', () => {
        const offenders = walk(path.join(BACKEND_ROOT, 'services'), ['.js'])
            .filter((f) => /INSERT\s+OR\s+REPLACE/i.test(read(f)))
            .map(rel)
            .filter((r) => !INSERT_OR_REPLACE_ALLOW.has(r));
        expect(offenders, `Use plain INSERT or INSERT OR IGNORE — never INSERT OR REPLACE: ${offenders.join(', ')}`).toEqual([]);
    });

    // Money is INTEGER rupiah, never float. Existing sponsor REAL columns are FROZEN; block new ones.
    // (Coordinate columns latitude/longitude are legitimately REAL and are not matched by the money names.)
    const REAL_MONEY_ALLOW = new Set([
        'database/migrations/add_sponsor_fields.js',
        'database/migrations/zz_20260523_add_sponsor_packages_and_camera_limit.js',
    ]);
    it('no NEW money/price column declared REAL in migrations', () => {
        /*
         * `w*` on BOTH sides of the word list, not just after it. The old pattern anchored with
         * `(price|...)`, and `` cannot match after an underscore — so every PREFIXED money
         * column slipped straight through: `product_price_rupiah REAL`, `sponsor_price REAL`,
         * `commission_amount REAL`, `total_biaya REAL` all passed a green suite. The guardrail
         * only ever caught a column named exactly `price` or `default_price`, which is the one
         * naming style nobody uses once a table has two money columns.
         *
         * Verified not to catch the legitimately-REAL neighbours: latitude, longitude,
         * viewport_zoom_override, confidence, score, duration_seconds.
         */
        const moneyReal = /w*(price|amount|harga|fee|saldo|balance|tarif|biaya)w*s+REAL/i;
        const offenders = walk(path.join(BACKEND_ROOT, 'database', 'migrations'), ['.js'])
            .filter((f) => moneyReal.test(read(f)))
            .map(rel)
            .filter((r) => !REAL_MONEY_ALLOW.has(r));
        expect(offenders, `Money columns must be INTEGER rupiah, not REAL: ${offenders.join(', ')}`).toEqual([]);
    });
    /*
     * ONE DATABASE LAYER, NOT TWO.
     *
     * `database/database.js` was a second connection layer with an identical API. Two
     * layers meant two live handles to the same file and two sets of pragmas — and that
     * drift was not theoretical: a busy_timeout mismatch between them was a real
     * incident. The 17 modules that used it now read through connectionPool, and the
     * module is deleted.
     *
     * It only became safe to converge once connectionPool learned to serve reads from
     * the writer while a transaction is open (see connectionPoolIsolation.test.js);
     * before that, moving a module would have silently broken read-your-own-writes
     * inside transactions. If anyone reintroduces the file, this fails.
     */
    it('no module imports the deleted second DB layer', () => {
        const offenders = ['services', 'controllers', 'routes', 'middleware', 'utils', 'database']
            .flatMap((d) => walk(path.join(BACKEND_ROOT, d), ['.js']))
            .filter((f) => /database\/database\.js|from ['"]\.\.?\/+database\.js['"]/.test(read(f)))
            .map(rel);
        expect(offenders, `Use database/connectionPool.js — database.js is deleted: ${offenders.join(', ')}`).toEqual([]);
    });

    it('database/database.js stays deleted', () => {
        expect(fs.existsSync(path.join(BACKEND_ROOT, 'database', 'database.js'))).toBe(false);
    });

    /*
     * SOURCE FILES ARE UTF-8, NO BOM. Earned 2026-08-03.
     *
     * A bulk edit run through PowerShell 5.1 corrupted 32 files at once. `Get-Content -Raw`
     * decodes a BOM-less file with the system ANSI codepage, so UTF-8 bytes came back as
     * cp1252 text; `Set-Content -Encoding utf8` then re-encoded that — double-encoding every
     * non-ASCII character — and prepended a BOM.
     *
     * It is not a cosmetic problem. The casualties included the emoji and bullets in the
     * Telegram notification templates (🔴 🟢 📹 📍 •) and an em-dash inside an admin API
     * response string — i.e. text users read. Tests stayed green throughout, because none of
     * them assert on those characters. Only a byte-level check catches it.
     */
    it('no source file carries a UTF-8 BOM or double-encoded (mojibake) text', () => {
        // Spelled as escapes on purpose: writing these as literal characters would put
        // the exact bytes we are hunting into this file, and the guardrail would flag
        // itself. \u00e2\u20ac leads a double-encoded em-dash/bullet; \u00c3 and \u00c2
        // lead the double-encoded Latin-1 range.
        const MOJIBAKE = /\u00e2\u20ac|\u00c3[\u00a9\u00a2\u00ab\u00bb]|\u00c2[\s\u00a0]/;
        const withBom = [];
        const withMojibake = [];

        for (const d of ['services', 'controllers', 'routes', 'middleware', 'utils', 'database', '__tests__']) {
            for (const file of walk(path.join(BACKEND_ROOT, d), ['.js'])) {
                const buf = fs.readFileSync(file);
                if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
                    withBom.push(rel(file));
                }
                if (MOJIBAKE.test(buf.toString('utf8'))) {
                    withMojibake.push(rel(file));
                }
            }
        }

        expect(withBom, `Files must be UTF-8 without a BOM: ${withBom.join(', ')}`).toEqual([]);
        expect(withMojibake, `Double-encoded text (edit these with a UTF-8-aware tool, not PowerShell Set-Content): ${withMojibake.join(', ')}`).toEqual([]);
    });
});

describe('guardrail: auth perimeter stays tested (coverage-floor surrogate)', () => {
    // The auth front door was 0-tests on a paying-customer system. These floors stop the tests being
    // silently deleted/gutted. True %-coverage thresholds need @vitest/coverage-v8 (not installed) +
    // CI running `--coverage`; until then this dependency-free test-count ratchet is the floor.
    // securityAuditLogger joined 2026-08-03. It was the one service in this perimeter with
    // no tests at all, which was backwards: it is the thing that records what every other
    // control did, and a lockout nobody can prove happened is not much of a lockout.
    // passwordExpiry joined 2026-08-03 for the same reason securityAuditLogger did: it is part
    // of this perimeter and sat at 0%. Writing those tests immediately turned up a latent
    // defect — both "list the affected users" functions were built on queryOne and reported a
    // single overdue account however many there were.
    const FLOOR = {
        authService: 10, sessionManager: 10, bruteForceProtection: 10,
        apiKeyService: 8, securityAuditLogger: 15, passwordExpiry: 12,
    };
    for (const [name, min] of Object.entries(FLOOR)) {
        it(`${name} keeps >= ${min} test cases`, () => {
            const file = path.join(BACKEND_ROOT, '__tests__', `${name}.test.js`);
            expect(fs.existsSync(file), `${name}.test.js is missing — the auth perimeter must stay tested`).toBe(true);
            const count = (read(file).match(/\bit\(/g) || []).length;
            expect(count, `${name}.test.js has ${count} test cases, below the floor of ${min}`).toBeGreaterThanOrEqual(min);
        });
    }
});

describe('guardrail: a mock cannot prove a constraint (real-dependency tests)', () => {
    /*
     * Earned 2026-07-28. Two bugs lived for months behind GREEN tests, both for the same reason:
     * the test mocked the exact thing whose behaviour WAS the bug.
     *
     *  - pruneAbsentActiveDiagnostics died on `UNIQUE constraint failed` every cycle for ~2 months.
     *    Its sibling test mocks `execute`, and a mocked execute can never raise a constraint error,
     *    so the suite stayed green while the prune resolved nothing at all.
     *  - The cacheMiddleware double-send only throws when Fastify's ASYNC onSend hooks defer the
     *    socket write. Without a real Fastify instance carrying those hooks, Fastify silently
     *    absorbs the second send and the test passes against broken code.
     *
     * So: when correctness depends on a DATABASE CONSTRAINT or on FRAMEWORK internals, the test
     * must exercise the real thing. Mocks are fine everywhere else.
     */
    const REAL_DEPENDENCY = {
        'backupService.test.js': 'better-sqlite3',
        'recordingRecoveryDiagnosticsPrune.test.js': 'better-sqlite3',
        'cacheMiddlewareDoubleReply.test.js': 'fastify',
    };
    for (const [testFile, dependency] of Object.entries(REAL_DEPENDENCY)) {
        it(`${testFile} exercises the real ${dependency}, not a mock`, () => {
            const file = path.join(BACKEND_ROOT, '__tests__', testFile);
            expect(fs.existsSync(file), `${testFile} is missing — it proves behaviour a mock cannot`).toBe(true);
            const src = read(file);
            expect(
                new RegExp(`from\\s+['"]${dependency}['"]`).test(src),
                `${testFile} must import ${dependency} directly; mocking it away is what hid the original bug`
            ).toBe(true);
        });
    }
});

describe('guardrail: a DB spy never falls through to the real database', () => {
    /*
     * Earned 2026-08-03, after chasing "flaky" backend tests that were nothing of the sort.
     *
     * `vi.spyOn(pool, 'queryOne').mockReturnValueOnce(a).mockReturnValueOnce(b)` calls THROUGH to
     * the real function once that queue is exhausted. So a chain with no terminal default does not
     * return undefined on the third call — it queries the developer's actual backend/data/cctv.db.
     * The test then depends on two things it never declares: how many DB calls the code happened to
     * make (which shifts with test ordering under parallel load), and what rows happen to exist
     * locally.
     *
     * That is not theoretical. cameraRuntimeStateService's regression test returned a
     * `monitoring_reason` that CHANGED between two consecutive runs — `media_sequence_progressing`,
     * then `provider_backoff_active` — values no fixture in the repo contains, because it was
     * reading live rows written by the health service. Five different tests across four files were
     * blamed on "load" before this was found.
     *
     * A terminal `.mockReturnValue(...)` costs one line and makes the mock total.
     */
    const DB_FNS = new Set(['queryOne', 'query']);
    const ONCE = /mockReturnValueOnce|mockResolvedValueOnce|mockImplementationOnce/;
    const TERMINAL = /mockReturnValue\(|mockResolvedValue\(|mockImplementation\(/;

    it('every Once-chain on query/queryOne ends in a terminal default', () => {
        const offenders = [];
        for (const name of fs.readdirSync(path.join(BACKEND_ROOT, '__tests__')).filter((f) => f.endsWith('.js'))) {
            const lines = read(path.join(BACKEND_ROOT, '__tests__', name)).split('\n');
            lines.forEach((line, i) => {
                const m = line.match(/spyOn\(\s*(\w+)\s*,\s*'(\w+)'\s*\)/);
                if (!m || !DB_FNS.has(m[2]) || !/pool|database|connection|db/i.test(m[1])) return;

                let chain = '';
                for (let j = i; j < Math.min(i + 120, lines.length); j += 1) {
                    chain += lines[j];
                    if (lines[j].includes(';')) break;
                }
                const withoutOnce = chain
                    .replace(/mockReturnValueOnce\(/g, 'X(')
                    .replace(/mockResolvedValueOnce\(/g, 'X(')
                    .replace(/mockImplementationOnce\(/g, 'X(');
                if (ONCE.test(chain) && !TERMINAL.test(withoutOnce)) {
                    offenders.push(`${name}:${i + 1} — spyOn(${m[1]}, '${m[2]}')`);
                }
            });
        }

        expect(
            offenders,
            '\nThese spy chains fall through to the REAL database once their Once-queue runs dry,'
            + '\nwhich makes the test depend on local DB contents and on test ordering.'
            + `\nAdd a terminal .mockReturnValue(undefined) / .mockReturnValue([]):\n  ${offenders.join('\n  ')}\n`
        ).toEqual([]);
    });
});

describe('guardrail: runtime-settings consumers are tested against an isolated database', () => {
    /*
     * Earned 2026-08-04, the same day the settings themselves moved into the DB.
     *
     * Security policy now resolves DB → env → default through securitySettingsService, so every
     * consumer of it reads the `settings` table on each call. A test that imports one of those
     * modules WITHOUT isolating the database silently asserts against whatever the developer's
     * cctv.db happens to hold — and stays green right up until an admin saves something in
     * Pengaturan → Keamanan.
     *
     * That is exactly how it surfaced: rateLimiterConfig's "falls back to defaults when env values
     * are absent" went red because a saved rateLimitAdmin=300 outranked the 60 it expected. The
     * test was right about the env layer and wrong about its own isolation.
     */
    const CONSUMERS = [
        'middleware/rateLimiter.js',
        'services/bruteForceProtection.js',
        'services/sessionManager.js',
        'services/passwordValidator.js',
        'services/passwordExpiry.js',
        'services/securitySettingsService.js',
    ].map((p) => path.basename(p, '.js'));

    // guardrails.test.js greps source text by name; it never imports these modules.
    const NOT_A_CONSUMER = new Set(['guardrails.test.js']);
    const ISOLATED = /vi\.mock\(\s*['"][^'"]*connectionPool\.js['"]|:memory:/;

    it('any test importing a settings consumer mocks the database', () => {
        const offenders = [];
        for (const name of fs.readdirSync(path.join(BACKEND_ROOT, '__tests__')).filter((f) => f.endsWith('.js'))) {
            if (NOT_A_CONSUMER.has(name)) continue;
            const src = read(path.join(BACKEND_ROOT, '__tests__', name));
            const imported = CONSUMERS.filter((m) => new RegExp(`(import|from)\\s*\\(?\\s*['"][^'"]*/${m}\\.js['"]`).test(src));
            if (imported.length && !ISOLATED.test(src)) {
                offenders.push(`${name} — imports ${imported.join(', ')}`);
            }
        }

        expect(
            offenders,
            '\nThese tests import a module that reads the runtime `settings` table, but do not isolate'
            + '\nthe database — so they assert against the local cctv.db and will flip the moment an'
            + '\nadmin saves a security setting. Add vi.mock of connectionPool.js (or an in-memory DB):'
            + `\n  ${offenders.join('\n  ')}\n`
        ).toEqual([]);
    });
});

describe('guardrail: a plan field the service understands is never dropped by the route schema', () => {
    /*
     * Earned 2026-08-04, twice in two days, on the money path.
     *
     * Fastify defaults ajv to `removeAdditional: true`. With `additionalProperties: false` — which
     * the plan routes use — a field the schema does not list is not rejected, it is silently
     * DELETED: the PUT returns 200, the panel looks like it saved, and the value never changes.
     * `recording_price_per_camera` shipped that way with six passing tests, because every one of
     * them called billingPlanService directly and none crossed the HTTP schema.
     *
     * So this compares the two lists mechanically: every column normalizePlanPayload can write must
     * appear in BOTH plan body schemas. The next column added cannot repeat the mistake quietly.
     */
    const routeSrc = read(path.join(BACKEND_ROOT, 'routes/billingAdminRoutes.js'));
    const serviceSrc = read(path.join(BACKEND_ROOT, 'services/billingPlanService.js'));

    // Fields normalizePlanPayload assigns — these are exactly what updatePlan will try to write.
    const understood = [...new Set(
        (serviceSrc.match(/^\s*out\.(\w+)\s*=/gm) || []).map((m) => m.replace(/^\s*out\./, '').replace(/\s*=$/, ''))
    )];

    const schemaFor = (marker) => {
        const start = routeSrc.indexOf(marker);
        if (start === -1) return null;
        const block = routeSrc.slice(start, routeSrc.indexOf('}, ', start));
        return new Set((block.match(/^\s{20}(\w+):\s*\{/gm) || []).map((m) => m.trim().replace(/:\s*\{$/, '')));
    };

    it('normalizePlanPayload writes nothing the POST/PUT schemas would strip', () => {
        expect(understood.length).toBeGreaterThan(5); // the extractor itself must not silently find nothing

        const gaps = [];
        for (const [label, marker] of [['POST /plans', "fastify.post('/plans'"], ['PUT /plans/:id', "fastify.put('/plans/:id'"]]) {
            const allowed = schemaFor(marker);
            expect(allowed, `tidak menemukan skema untuk ${label}`).toBeTruthy();
            for (const field of understood) {
                if (!allowed.has(field)) gaps.push(`${label} tidak mendaftarkan "${field}"`);
            }
        }

        expect(
            gaps,
            '\nThese fields are understood by billingPlanService but missing from a plan route schema.'
            + '\najv will DELETE them from the request body and answer 200, so the panel will appear to'
            + `\nsave and change nothing:\n  ${gaps.join('\n  ')}\n`
        ).toEqual([]);
    });
});

describe('guardrail: no live-looking Telegram archive routes inside the repo', () => {
    /*
     * The archive's real routing lives at /opt/tg-archive/routes.json, outside the repo, and the
     * admin panel writes to that exact path. A copy named `routes.json` used to sit in
     * deployment/tg-archive/ and drifted: one route pointing at a group that no longer exists
     * (getChat answered "chat not found"), while production ran three entirely different ones.
     *
     * Copying that file over the live one would stop archiving SILENTLY — a camera matching no
     * route is marked `no_route` and nothing errors. So the repo keeps an example only, with every
     * route disabled and placeholder chat IDs, and this fails if either rule is broken again.
     */
    const DIR = path.join(BACKEND_ROOT, '..', 'deployment', 'tg-archive');

    it('keeps an example, never a file named routes.json', () => {
        expect(fs.existsSync(path.join(DIR, 'routes.json')),
            '\ndeployment/tg-archive/routes.json is back. Live routing belongs at'
            + '\n/opt/tg-archive/routes.json (panel-edited); the repo keeps routes.example.json only.\n')
            .toBe(false);
        expect(fs.existsSync(path.join(DIR, 'routes.example.json'))).toBe(true);
    });

    it('the example carries no real chat id and nothing enabled', () => {
        const doc = JSON.parse(read(path.join(DIR, 'routes.example.json')));
        const nyata = doc.routes.filter((r) => !/X{4,}/.test(String(r.chatId)));
        const aktif = doc.routes.filter((r) => r.enabled);

        expect(nyata.map((r) => r.id),
            '\nA real chat id in the example is both a leak and a copy-paste trap.').toEqual([]);
        expect(aktif.map((r) => r.id),
            '\nAn enabled example route invites being copied as-is.').toEqual([]);
    });
});

describe('guardrail: data-destroying paths stay tested', () => {
    /*
     * backupService could DELETE a live row on restore (INSERT OR REPLACE) and had ZERO tests for
     * years. Anything that can destroy or overwrite real rows keeps a test floor, same idea as the
     * auth perimeter above.
     */
    const FLOOR = { backupService: 6, recordingRecoveryDiagnosticsPrune: 4 };
    for (const [name, min] of Object.entries(FLOOR)) {
        it(`${name} keeps >= ${min} test cases`, () => {
            const file = path.join(BACKEND_ROOT, '__tests__', `${name}.test.js`);
            expect(fs.existsSync(file), `${name}.test.js is missing — this path can destroy real data`).toBe(true);
            const count = (read(file).match(/\bit\(/g) || []).length;
            expect(count, `${name}.test.js has ${count} test cases, below the floor of ${min}`).toBeGreaterThanOrEqual(min);
        });
    }
});

describe('guardrail: governance docs reference no deleted files (doc-lint)', () => {
    // Catches the "stale reference to a deleted/renamed file" drift (the shim/Playback class of bug).
    // README is excluded — it is an ops runbook full of external/illustrative paths.
    const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
    const DOCS = [
        'SYSTEM_MAP.md', 'AGENTS.md', 'CLAUDE.md',
        'docs/frontend-guide.md', 'docs/billing-rental.md',
        'backend/.module_map.md', 'backend/services/.module_map.md',
        'backend/utils/.module_map.md', 'frontend/src/.module_map.md',
    ];
    // Repo-relative file paths only; the (?![A-Za-z]) stops `package.json` matching as `.js`.
    const PATH_RE = /\b(?:backend|frontend|docs|deployment|mediamtx)\/[A-Za-z0-9_./-]+\.(?:js|jsx|cjs|md)(?![A-Za-z])/g;
    it('every repo-relative file path in the agent docs still exists', () => {
        const broken = [];
        for (const doc of DOCS) {
            const full = path.join(REPO_ROOT, doc);
            if (!fs.existsSync(full)) continue;
            for (const ref of (fs.readFileSync(full, 'utf8').match(PATH_RE) || [])) {
                if (!fs.existsSync(path.join(REPO_ROOT, ref))) broken.push(`${doc} → ${ref}`);
            }
        }
        expect(broken, `\nGovernance docs point at files that no longer exist (fix the doc in the same PR):\n  ${broken.join('\n  ')}\n`).toEqual([]);
    });
});

/*
 * A light background with no dark counterpart is invisible in review and catastrophic in use.
 *
 * /daftar shipped with `bg-white` on its card and no dark pair. Every notice inside it DID carry a
 * dark variant, so each one looked handled — but a 30%-opacity dark tint composited over white
 * turns pale, and pale text on pale ground is unreadable. The registration page, the end of the
 * whole sales funnel, was illegible on any dark-mode phone and nothing failed.
 *
 * Two exclusions keep this honest rather than noisy:
 *  - a dark pair may be `dark:bg-`, `dark:hover:bg-`, `dark:focus:bg-` … all count;
 *  - a white scrim under 50% opacity sits on video or a coloured button, where white is correct in
 *    both themes. Those are not defects.
 *
 * The 21 that remain are deliberate: white knobs on toggle switches, play buttons over video
 * thumbnails, and one white panel behind a payment QR code (a QR must be light to scan). Ratcheted
 * rather than zeroed — the number may fall, never rise.
 */
describe('guardrail: a light surface always declares its dark counterpart', () => {
    const FRONTEND_SRC = path.resolve(BACKEND_ROOT, '..', 'frontend', 'src');
    const SISA = 21;

    const TERANG = /\bbg-(white|gray-(50|100|200|300)|slate-(50|100|200)|zinc-(50|100|200)|neutral-(50|100|200)|emerald-(50|100)|green-(50|100)|red-(50|100)|amber-(50|100)|yellow-(50|100)|sky-(50|100)|blue-(50|100)|indigo-(50|100)|violet-(50|100)|purple-(50|100)|rose-(50|100)|orange-(50|100)|teal-(50|100)|cyan-(50|100)|primary-(50|100))(\/\d{1,3})?\b/g;
    const PASANGAN = /dark:(?:[a-z-]+:)*bg-/;
    const ATTR = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{"([^"]*)"\}|\{'([^']*)'\})/g;
    const opaque = (c) => { const m = /\/(\d{1,3})$/.exec(c); return !m || Number(m[1]) >= 50; };

    it(`does not grow past the ${SISA} deliberate exceptions`, () => {
        if (!fs.existsSync(FRONTEND_SRC)) return; // backend-only checkout
        const offenders = [];
        for (const file of walk(FRONTEND_SRC, ['.jsx', '.js'])) {
            if (/\.test\.|\.spec\./.test(file)) continue;
            const src = read(file);
            let m;
            while ((m = ATTR.exec(src)) !== null) {
                const cls = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
                const hits = (cls.match(TERANG) || []).filter(opaque);
                if (!hits.length || PASANGAN.test(cls)) continue;
                const line = src.slice(0, m.index).split('\n').length;
                offenders.push(`${path.relative(FRONTEND_SRC, file).split(path.sep).join('/')}:${line} — ${hits.join(' ')}`);
            }
        }
        expect(
            offenders.length,
            `\nLight surfaces without a dark counterpart: ${offenders.length} (allowed ${SISA}).\n`
            + `Use the semantic tokens (bg-surface / bg-surface-sunken / bg-primary/10) — they follow the\n`
            + `theme by definition. If a case is genuinely theme-independent (a switch knob, something\n`
            + `over video, a QR backdrop), say so in a comment and lower SISA when the count drops.\n\n  `
            + offenders.join('\n  ') + '\n',
        ).toBeLessThanOrEqual(SISA);
    });
});
/*
 * Cakupan penyelaras waktu didefinisikan DUA KALI - sekali di Python (yang memeriksa kamera),
 * sekali di Node (yang menampilkan hasilnya di panel admin). Keduanya HARUS sama persis:
 * kalau panel menampilkan kamera yang tidak pernah diperiksa penyelaras, ia melaporkan
 * "belum diketahui" untuk sesuatu yang memang tak pernah jadi urusannya.
 *
 * Itu bukan kekhawatiran teoretis. Versi pertama panel memakai `LIKE 'rtsp://%@%'` dan
 * menampilkan 409 kamera padahal penyelaras hanya memeriksa 14 - 394 feed pihak ketiga di IP
 * publik ikut terbawa dan panelnya berteriak "396 perlu perhatian". 96% derau.
 *
 * Dibandingkan sebagai TEKS, dan karena itu kedua sisi sengaja ditulis tanpa alias tabel:
 * predikat yang butuh transformasi di salah satu sisi akan mulai berpisah diam-diam.
 */

describe('guardrail: cakupan jam kamera sama di Python dan Node', () => {
    /*
     * Cakupan penyelaras waktu didefinisikan DUA KALI - sekali di Python (yang memeriksa
     * kamera), sekali di Node (yang menampilkan hasilnya). Keduanya HARUS sama persis: panel
     * yang menampilkan kamera yang tidak pernah diperiksa penyelaras melaporkan "belum
     * diketahui" untuk sesuatu yang memang bukan urusannya.
     *
     * Bukan kekhawatiran teoretis: versi pertama panel menerima setiap kamera ber-URL RTSP dan
     * menampilkan 409 padahal penyelaras memeriksa 14 - 394 feed pihak ketiga di IP publik ikut
     * terbawa, dan panelnya berteriak "396 perlu perhatian". Sembilan puluh enam persen derau.
     *
     * Diambil dari PREDIKAT SQL-nya, bukan dari sintaksis pembungkus tiap bahasa. Dua percobaan
     * sebelumnya memotong pada penutup kurung dan meleset karena kutip di sisi Python, lalu
     * menelan separuh berkas - persis jenis kegagalan yang membuat orang melonggarkan asersinya
     * alih-alih memperbaiki alat ukurnya.
     */
    const AWAL = 'enabled = 1 AND (';
    const AKHIR = '172.3[01].*)';

    const ambilPredikat = (teks) => {
        const bersih = teks
            .replace(/["']/g, '')
            .replace(/\s*\+\s*/g, ' ')
            .replace(/\s+/g, ' ');
        const i = bersih.indexOf(AWAL);
        if (i === -1) return null;
        const j = bersih.indexOf(AKHIR, i);
        if (j === -1) return null;
        return bersih.slice(i, j + AKHIR.length).trim();
    };

    const bacaPy = () => fs.readFileSync(
        path.join(BACKEND_ROOT, '..', 'deployment', 'camera-time', 'set_camera_ntp.py'), 'utf8');
    const bacaJs = () => fs.readFileSync(
        path.join(BACKEND_ROOT, 'services', 'cameraTimeStatusService.js'), 'utf8');

    it('predikat cakupan identik di kedua bahasa', () => {
        const py = ambilPredikat(bacaPy());
        const js = ambilPredikat(bacaJs());

        expect(py, 'predikat tidak ditemukan di set_camera_ntp.py').toBeTruthy();
        expect(js, 'predikat tidak ditemukan di cameraTimeStatusService.js').toBeTruthy();
        expect(js).toBe(py);
    });

    it('cakupannya membatasi ke rentang privat, bukan menerima semua', () => {
        /*
         * Anti-hampa: predikat yang menerima apa pun akan membuat tes di atas tetap hijau.
         * Diperiksa pada PREDIKAT hasil ekstraksi, bukan pada berkas mentah - kalau tidak,
         * komentar yang MENJELASKAN pola lama akan dikira pola lama itu sendiri. Saya kena
         * jerat itu satu putaran sebelum ini.
         */
        const js = ambilPredikat(bacaJs());

        expect(js).toContain('192.168.');
        expect(js).toContain('172.1[6-9]');
        expect(js).toContain('rtsp://%@10.');
        expect(js).not.toContain('LIKE rtsp://%@% OR');
    });
});
