/**
 * Purpose: Parse, normalize, and validate the id lists that define a playback token's scope.
 * Caller: playbackTokenService (create/update/sanitize paths).
 * Deps: none — pure functions only.
 * MainFuncs: normalizeCameraIds, normalizeAreaIds, parseCameraIdsJson, parseAreaIdsJson, resolveAreaIdsForWrite.
 * SideEffects: none.
 *
 * Extracted from playbackTokenService because that file sits at its frozen size ceiling: the ratchet
 * requires shrinking rather than raising the baseline, and pure id handling is the cleanest thing to
 * lift out of a service otherwise full of I/O.
 *
 * Camera ids and area ids validate identically and are catastrophic to confuse — reading one as the
 * other resolves a token to a different set of cameras. They therefore keep separate names at every
 * call site even though the implementations agree.
 */

function normalizeIdList(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return [...new Set(value
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item > 0))];
}

function parseIdListJson(value) {
    try {
        return normalizeIdList(JSON.parse(value || '[]'));
    } catch {
        return [];
    }
}

export function normalizeCameraIds(value) {
    return normalizeIdList(value);
}

export function normalizeAreaIds(value) {
    return normalizeIdList(value);
}

export function parseCameraIdsJson(value) {
    return parseIdListJson(value);
}

export function parseAreaIdsJson(value) {
    return parseIdListJson(value);
}

/**
 * Area ids to persist for a write, or [] when the token is not area-scoped.
 *
 * `existing` is used only when the caller sent no area_ids at all, so an edit that touches just the
 * label round-trips the areas back unchanged instead of quietly emptying them — which would lock the
 * holder out of every camera while still looking like a successful save.
 */
export function resolveAreaIdsForWrite(scopeType, provided, existing = undefined) {
    if (scopeType !== 'area') {
        return [];
    }

    const areaIds = provided === undefined
        ? normalizeAreaIds(existing)
        : normalizeAreaIds(provided);

    if (areaIds.length === 0) {
        const err = new Error('Pilih minimal satu area untuk scope area');
        err.statusCode = 400;
        throw err;
    }

    return areaIds;
}
