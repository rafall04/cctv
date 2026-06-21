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
