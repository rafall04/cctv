/*
 * Purpose: One source of truth for whether the Saweria ask is switched on, and one fetch for it.
 * Caller: SaweriaSupport (floating banner), SupportInlineNote (line under the video).
 * Deps: saweriaService.getPublicSaweriaConfig (which owns the early-prefetch seed + in-flight dedupe).
 * MainFuncs: isSaweriaEnabled, SAWERIA_SUPPRESSED_KEY, SAWERIA_URL.
 * SideEffects: Shares the single GET /api/saweria/config, memoised here for the page's lifetime.
 *
 * The promise is cached rather than the value, so two components mounting in the same tick share
 * one request instead of racing two — the inline note lives inside a popup that can open and
 * close repeatedly, and it must not re-ask the backend every time. Riding the service keeps this
 * consumer on the same fetch path (apiClient + seed + dedupe) as the landing config loader.
 */

import { getPublicSaweriaConfig } from '../services/saweriaService.js';

export const SAWERIA_SUPPRESSED_KEY = 'saweria_dont_show';
export const SAWERIA_URL = 'https://saweria.co/raflialdi';

let inflight = null;

/**
 * @returns {Promise<boolean>} true when the operator has the Saweria ask enabled.
 *   Never throws and never rejects — a config we cannot read means "stay quiet".
 */
export function isSaweriaEnabled() {
    if (!inflight) {
        inflight = getPublicSaweriaConfig()
            .then((data) => data?.data?.enabled === true)
            .catch(() => false);
    }
    return inflight;
}

/** Test seam: drop the memoised request so each test starts from a clean slate. */
export function resetSaweriaConfigCache() {
    inflight = null;
}
