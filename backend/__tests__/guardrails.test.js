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
        'services/cameraHealthService.js': 3161,
        'services/cameraService.js': 2773,
        'services/hlsProxyService.js': 1581,
        'services/playbackTokenService.js': 1334,
        'middleware/schemaValidators.js': 949,
        'services/telegramService.js': 944,
        'services/externalStreamProxyService.js': 896,
        'services/telegramBotService.js': 890,
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
        const moneyReal = /\b(price|amount|default_price|harga|fee|saldo|balance|tarif|biaya)\w*\s+REAL\b/i;
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
    const FLOOR = {
        authService: 10, sessionManager: 10, bruteForceProtection: 10,
        apiKeyService: 8, securityAuditLogger: 15,
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
