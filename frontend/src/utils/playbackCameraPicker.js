/*
 * Purpose: Search/group/facet logic for the public playback camera picker.
 * Caller: components/playback/PlaybackCameraPicker.jsx (and its tests).
 * Deps: none — deliberately pure so the matching rules can be tested without rendering.
 * MainFuncs: normalizeText, cameraSearchHaystack, filterCameras, filterByArea, groupCamerasByArea,
 *   areaFacets, distinctLocation.
 * SideEffects: None.
 *
 * The naming in this dataset is operator-entered and inconsistent on purpose — it is real data and
 * we do not rewrite it. Within the 36 live cameras you find "SIMPANG 4 BUNDARAN JETAK",
 * "S4_Ngariboyo", "Jl. Basuki Rahmat Timur - Alun-Alun" and "JL RAYA MAOSPATI - S4 BANI SOLAN":
 * mixed case, mixed punctuation, and two different spellings of the same word (junction). A picker
 * that matched raw substrings would make half of them unfindable, so the matching layer absorbs the
 * inconsistency instead of the visitor having to guess it.
 */

/** Lowercase and reduce every run of punctuation to a single space, so "S4_Ngariboyo",
 *  "S4-Ngariboyo" and "s4 ngariboyo" all become the same string. */
export function normalizeText(value) {
    return String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/* "S4" and "SIMPANG 4" mean the same junction, and the dataset uses both. Indexing each name under
 * both spellings means typing either one finds every camera, which is the whole point. */
const CONTRACTED_TO_LONG = /\bs([234])\b/g;
const LONG_TO_CONTRACTED = /\bsimpang ([234])\b/g;

/**
 * Everything a visitor might plausibly type for this camera, as one normalized string:
 * its name, its location, its area, plus both junction spellings.
 */
export function cameraSearchHaystack(camera) {
    const base = normalizeText(
        [camera?.name, camera?.location, camera?.area_name].filter(Boolean).join(' '),
    );
    if (!base) return '';

    const variants = new Set([
        base,
        base.replace(CONTRACTED_TO_LONG, 'simpang $1'),
        base.replace(LONG_TO_CONTRACTED, 's$1'),
    ]);
    return [...variants].join(' ');
}

/**
 * Cameras matching every word in `query`, in any order — "cipto simpang" finds
 * "SIMPANG 4 BASUKI RAHMAT - DR. CIPTO". AND rather than OR: with 36 cameras sharing words like
 * "SIMPANG", an OR match returns almost the whole list and helps nobody.
 */
export function filterCameras(cameras, query) {
    const list = Array.isArray(cameras) ? cameras : [];
    const tokens = normalizeText(query).split(' ').filter(Boolean);
    if (!tokens.length) return [...list];

    return list.filter((camera) => {
        const haystack = cameraSearchHaystack(camera);
        return tokens.every((token) => haystack.includes(token));
    });
}

const FALLBACK_AREA = 'Lainnya';

const areaKey = (camera) => (String(camera?.area_name ?? '').trim() || FALLBACK_AREA);

/* Areas alphabetical, cameras alphabetical inside each, and the area-less bucket always last so it
 * reads as a remainder rather than as a real place. */
const byArea = (a, b) => (a === FALLBACK_AREA ? 1 : b === FALLBACK_AREA ? -1 : a.localeCompare(b, 'id'));
const byName = (a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'id');

/** @returns {Array<{ area: string, cameras: object[] }>} */
export function groupCamerasByArea(cameras) {
    const groups = new Map();
    for (const camera of Array.isArray(cameras) ? cameras : []) {
        const key = areaKey(camera);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(camera);
    }
    for (const list of groups.values()) list.sort(byName);

    return [...groups.entries()]
        .sort(([a], [b]) => byArea(a, b))
        .map(([area, list]) => ({ area, cameras: list }));
}

/** Cameras in one facet. `'all'` (or an unknown key) means no narrowing. */
export function filterByArea(cameras, key) {
    const list = Array.isArray(cameras) ? cameras : [];
    if (!key || key === 'all') return [...list];
    return list.filter((camera) => areaKey(camera) === key);
}

/**
 * The location, but only when it says something the name does not.
 *
 * Most cameras here are named after their location, so printing both gave rows like
 * "SIMPANG 4 BUNDARAN JETAK / SIMPANG 4 BUNDARAN JETAK" — a second line that costs space and
 * carries no information. Returns '' when there is nothing worth adding.
 */
export function distinctLocation(camera) {
    const name = normalizeText(camera?.name);
    const location = String(camera?.location ?? '').trim();
    const normalizedLocation = normalizeText(location);
    if (!normalizedLocation) return '';
    if (name === normalizedLocation || name.includes(normalizedLocation) || normalizedLocation.includes(name)) {
        return '';
    }
    return location;
}

/**
 * Filter chips for the picker: every area with its count, plus an "all" chip first.
 * Counts come from the UNFILTERED list on purpose — a chip that renumbered itself as you typed
 * would make the totals unreadable.
 * @returns {Array<{ key: string, label: string, count: number }>}
 */
export function areaFacets(cameras) {
    const list = Array.isArray(cameras) ? cameras : [];
    return [
        { key: 'all', label: 'Semua', count: list.length },
        ...groupCamerasByArea(list).map(({ area, cameras: inArea }) => ({
            key: area,
            label: area,
            count: inArea.length,
        })),
    ];
}
