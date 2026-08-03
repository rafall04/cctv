/*
 * Purpose: One source of truth for whether the Saweria ask is switched on, and one fetch for it.
 * Caller: SaweriaSupport (floating banner), SupportInlineNote (line under the video).
 * Deps: fetch.
 * MainFuncs: isSaweriaEnabled, SAWERIA_SUPPRESSED_KEY, SAWERIA_URL.
 * SideEffects: A single GET /api/saweria/config per page load, memoised.
 *
 * The promise is cached rather than the value, so two components mounting in the same tick share
 * one request instead of racing two — the inline note lives inside a popup that can open and
 * close repeatedly, and it must not re-ask the backend every time.
 */

export const SAWERIA_SUPPRESSED_KEY = 'saweria_dont_show';
export const SAWERIA_URL = 'https://saweria.co/raflialdi';

const REQUEST_TIMEOUT_MS = 3000;

let inflight = null;

/**
 * @returns {Promise<boolean>} true when the operator has the Saweria ask enabled.
 *   Never throws and never rejects — a config we cannot read means "stay quiet".
 */
export function isSaweriaEnabled() {
    if (!inflight) {
        inflight = (async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
                const response = await fetch('/api/saweria/config', { signal: controller.signal })
                    .catch(() => null);
                clearTimeout(timeoutId);

                if (!response?.ok) return false;
                const data = await response.json().catch(() => null);
                return data?.data?.enabled === true;
            } catch {
                return false;
            }
        })();
    }
    return inflight;
}

/** Test seam: drop the memoised request so each test starts from a clean slate. */
export function resetSaweriaConfigCache() {
    inflight = null;
}
