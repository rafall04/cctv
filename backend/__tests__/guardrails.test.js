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
    // pattern that once cost a real customer row. Existing uses are FROZEN (tracked for follow-up fix);
    // no NEW occurrences allowed.
    const INSERT_OR_REPLACE_ALLOW = new Set([
        'services/backupService.js',
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
});

describe('guardrail: auth perimeter stays tested (coverage-floor surrogate)', () => {
    // The auth front door was 0-tests on a paying-customer system. These floors stop the tests being
    // silently deleted/gutted. True %-coverage thresholds need @vitest/coverage-v8 (not installed) +
    // CI running `--coverage`; until then this dependency-free test-count ratchet is the floor.
    const FLOOR = { authService: 10, sessionManager: 10, bruteForceProtection: 10, apiKeyService: 8 };
    for (const [name, min] of Object.entries(FLOOR)) {
        it(`${name} keeps >= ${min} test cases`, () => {
            const file = path.join(BACKEND_ROOT, '__tests__', `${name}.test.js`);
            expect(fs.existsSync(file), `${name}.test.js is missing — the auth perimeter must stay tested`).toBe(true);
            const count = (read(file).match(/\bit\(/g) || []).length;
            expect(count, `${name}.test.js has ${count} test cases, below the floor of ${min}`).toBeGreaterThanOrEqual(min);
        });
    }
});
