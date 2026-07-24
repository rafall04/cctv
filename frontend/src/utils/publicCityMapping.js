/*
 * Purpose: Roll public camera `area_name` values up to a clean CITY label for the
 *          public landing city switcher. The backend `area_name` field mixes admin
 *          levels ("KAB SURABAYA", "DI YOGYAKARTA", "KEC BOJONEGORO DAN SEKITARNYA",
 *          "DS DANDER"...), so this presentation-layer util groups them into the real
 *          cities citizens recognise. It NEVER mutates data — display only.
 * Caller: Public landing command bar / city switcher and its controller.
 * Deps: normalizeAreaKey from mapCoordinateUtils.js (same trim/lowercase key rule).
 * MainFuncs: getAreaCity, getCameraCityKey, groupCamerasByCity.
 * SideEffects: None.
 */

import { normalizeAreaKey } from './mapCoordinateUtils.js';

/*
 * Explicit rollup of known area_name values → one canonical city. Village/district
 * areas fold into their parent city so the switcher shows cities, not a KAB/KOTA/DS/KEC
 * mix. Keys are normalizeAreaKey() form (trimmed, lowercased, single-spaced).
 */
const AREA_CITY_OVERRIDES = {
    'ds dander': { key: 'bojonegoro', label: 'Bojonegoro' },
    'ds tanjungharjo': { key: 'bojonegoro', label: 'Bojonegoro' },
    'kec bojonegoro dan sekitarnya': { key: 'bojonegoro', label: 'Bojonegoro' },
    'kab surabaya': { key: 'surabaya', label: 'Surabaya' },
    'di yogyakarta': { key: 'yogyakarta', label: 'Yogyakarta' },
    'kota surakarta': { key: 'solo', label: 'Solo' },
    'kab jombang': { key: 'jombang', label: 'Jombang' },
    'kab magetan': { key: 'magetan', label: 'Magetan' },
    'kab bangkalan': { key: 'bangkalan', label: 'Bangkalan' },
};

// Leading administrative-level prefix, stripped for areas not in the override table
// so unknown/future areas render a clean label instead of a raw "KAB …" string.
const LEVEL_PREFIX = /^(kabupaten|kotamadya|kota|kab|daerah istimewa|di|kecamatan|kec|kelurahan|kel|desa|ds|dusun|dsn)\.?\s+/;

const titleCase = (value) => value.replace(/\S+/g, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

/**
 * Resolve a raw area_name to its city { key, label }. Falls back to a
 * prefix-stripped, title-cased label for areas outside the override table.
 */
export function getAreaCity(areaName) {
    const norm = normalizeAreaKey(areaName);
    if (!norm) {
        return { key: '', label: '' };
    }
    if (AREA_CITY_OVERRIDES[norm]) {
        return AREA_CITY_OVERRIDES[norm];
    }
    let label = norm.replace(LEVEL_PREFIX, '').replace(/\s+dan sekitarnya$/, '').trim();
    if (!label) {
        label = norm;
    }
    return { key: label.replace(/\s+/g, '-'), label: titleCase(label) };
}

/** City key for a single camera (empty string when the camera has no area). */
export function getCameraCityKey(camera) {
    return getAreaCity(camera?.area_name).key;
}

/**
 * Group a camera list into cities for the switcher.
 * Returns [{ key, label, count }] sorted by count desc, then label asc.
 */
export function groupCamerasByCity(cameras = []) {
    const cities = new Map();
    (Array.isArray(cameras) ? cameras : []).forEach((camera) => {
        const { key, label } = getAreaCity(camera?.area_name);
        if (!key) {
            return;
        }
        const entry = cities.get(key) || { key, label, count: 0 };
        entry.count += 1;
        cities.set(key, entry);
    });
    return Array.from(cities.values())
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
