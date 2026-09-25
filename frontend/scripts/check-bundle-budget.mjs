#!/usr/bin/env node
/**
 * Bundle budget guardrail (F4.5) — runs after `vite build`, reads dist/assets.
 *
 * Same ratchet philosophy as backend file-size guardrails: the chunks that are
 * already large are FROZEN near their measured size so they cannot quietly grow,
 * and any NEW chunk above the generic ceiling fails the build. Budgets are raw
 * bytes (gzip varies by CDN/brotli anyway — a raw cap is the stable signal).
 *
 * Baseline measured 2026-09-21 on main (vite 5.x):
 *   JS total ~2.55 MiB over 107 chunks; CSS ~146 KiB.
 *
 * Caller: CI e2e job (after npm run build); can also be run locally.
 * Exit 1 with a readable offender list when any budget is exceeded.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(fileURLToPath(import.meta.url), '..', '..', 'dist', 'assets');

// ---- Budgets ---------------------------------------------------------------
// Frozen giants: name prefix → max bytes (~6% headroom over measured baseline).
// Shrinking a frozen chunk is welcome; growing it past the cap is a failure.
const FROZEN_CHUNKS = {
    'video-player-': 360_000, // measured 342,776
    'App-': 265_000,          // measured 250,090
    'react-vendor-': 172_000, // measured 163,021
    'map-vendor-': 170_000,   // measured 161,696
    'flv-': 164_000,          // measured 156,371
    'AudioBroadcast-': 157_000, // measured 149,052
};

// A chunk nobody has reviewed yet gets a tighter budget — split before it grows.
const NEW_CHUNK_MAX = 150_000;

// Aggregate ceilings: total ship weight, not just per-file.
const TOTAL_JS_MAX = 2_950_000;  // ~2.81 MiB, ~10% over measured 2,676,868
const TOTAL_CSS_MAX = 200_000;   // measured 149,216
// ----------------------------------------------------------------------------

if (!existsSync(DIST)) {
    console.error(`[bundle-budget] ${DIST} not found — run \`npm run build\` first.`);
    process.exit(1);
}

const offenders = [];
let totalJs = 0;
let totalCss = 0;
let jsChunks = 0;

for (const file of readdirSync(DIST)) {
    const size = statSync(join(DIST, file)).size;
    if (file.endsWith('.js')) {
        totalJs += size;
        jsChunks += 1;
        const frozenPrefix = Object.keys(FROZEN_CHUNKS).find((p) => file.startsWith(p));
        if (frozenPrefix) {
            const cap = FROZEN_CHUNKS[frozenPrefix];
            if (size > cap) {
                offenders.push(`${file}: ${size} B > ${cap} B (frozen chunk — extract/defer code, do not grow)`);
            }
        } else if (size > NEW_CHUNK_MAX) {
            offenders.push(`${file}: ${size} B > ${NEW_CHUNK_MAX} B (new chunk over budget — split it or add a deliberate frozen entry)`);
        }
    } else if (file.endsWith('.css')) {
        totalCss += size;
    }
}

if (totalJs > TOTAL_JS_MAX) {
    offenders.push(`TOTAL JS: ${totalJs} B > ${TOTAL_JS_MAX} B across ${jsChunks} chunks`);
}
if (totalCss > TOTAL_CSS_MAX) {
    offenders.push(`TOTAL CSS: ${totalCss} B > ${TOTAL_CSS_MAX} B`);
}

if (offenders.length > 0) {
    console.error('[bundle-budget] FAIL\n' + offenders.map((o) => `  - ${o}`).join('\n'));
    process.exit(1);
}

console.log(`[bundle-budget] OK — ${jsChunks} JS chunks, ${totalJs} B JS, ${totalCss} B CSS`);
